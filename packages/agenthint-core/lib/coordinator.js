/**
 * Session-scoped control queue, bounded barriers and ordinary-request leases.
 *
 * The coordinator owns every piece of cross-request state that makes the
 * protocol safe:
 *
 * - a per-session queue so a cache mutation never races new inference;
 * - a barrier that turns a pending or unknown mutation into a stable
 *   `CONTROL_BARRIER` failure instead of a retryable transport error;
 * - a full-stream lease so `pause`/`stop` wait for the model stream to end;
 * - quarantine of sessions whose mutation outcome is unknown, which survives
 *   disposal and reopen until an operator resolves it.
 *
 * It knows nothing about any host: sessions are plain strings, requests are
 * classified by the host, and control commands leave through a
 * {@link ControlTransport}. Cross-session policy — such as which session the
 * foreground moved away from — belongs to the adapter, because that policy is
 * meaningful only inside one host's interaction model.
 *
 * @module agenthint-core/coordinator
 */
import { AgentHintError, controlBarrierError } from "./errors.js";
import { buildAgentHint } from "./hint.js";
/** Default bound on how long a request waits for an in-flight mutation. */
export const DEFAULT_PENDING_OP_AWAIT_MS = 2_000;
/** Default cool-down before a failed advisory prefetch may be re-requested. */
export const DEFAULT_RESUME_COOLDOWN_MS = 1_000;
function freshState() {
    return {
        archived: false, seeded: false, resumeSent: false, resumeAttempt: {}, nextResumeAt: 0,
        idle: true, pausePending: false, pauseSent: false, firstOrdinarySent: false,
        parentSessionId: undefined, lastModel: undefined, pendingOp: undefined, mutations: 0,
        unsafe: false, generation: 0, incarnation: {}, active: 0, preparing: 0,
        dataIdle: undefined, releaseData: undefined,
    };
}
/**
 * Coordinates AgentHint control state for one trust scope.
 *
 * Create one instance per isolated interaction scope (single-user runtime,
 * one workspace, one agent instance). Sharing one instance across users would
 * let one user's traffic pause another user's session, so hosts that serve
 * several scopes must hold several coordinators.
 */
export class HintCoordinator {
    options;
    states = new Map();
    disposed = false;
    lifetime = new AbortController();
    pendingOpAwaitMs;
    resumeCooldownMs;
    now;
    constructor(options) {
        this.options = options;
        this.pendingOpAwaitMs = options.pendingOpAwaitMs ?? DEFAULT_PENDING_OP_AWAIT_MS;
        this.resumeCooldownMs = options.resumeCooldownMs ?? DEFAULT_RESUME_COOLDOWN_MS;
        this.now = options.now ?? (() => Date.now());
    }
    /** Aborted when the coordinator is disposed. */
    get signal() { return this.lifetime.signal; }
    /** Whether {@link dispose} has run. */
    get isDisposed() { return this.disposed; }
    /**
     * Stop all work. Cancels waits and in-flight sends; no new control command is
     * produced afterwards. Outstanding uncertainty is intentionally not cleared:
     * a disposed coordinator must not be read as "the backend is safe".
     */
    dispose() {
        this.disposed = true;
        this.lifetime.abort();
        for (const state of this.states.values())
            state.releaseData?.();
        this.states.clear();
    }
    // ---------------------------------------------------------------- lifecycle
    /**
     * Record that a session exists.
     *
     * Outstanding operations and uncertainty are deliberately preserved across a
     * disposal/reopen cycle: a reopened session must not look safe just because
     * its previous incarnation ended.
     */
    registerSession(facts) {
        if (this.disposed)
            return;
        const state = this.state(facts.sessionId);
        state.incarnation = {};
        state.seeded = facts.seeded;
        state.firstOrdinarySent = false;
        state.resumeSent = false;
        state.resumeAttempt = {};
        state.idle = true;
        state.pausePending = false;
        state.pauseSent = false;
        state.parentSessionId = facts.parentSessionId;
    }
    /** Report whether the host considers this session idle (no turn in flight). */
    setAgentIdle(sessionId, idle) {
        if (this.disposed)
            return;
        const state = this.state(sessionId);
        state.idle = idle;
        if (idle)
            this.maybePauseIfIdle(sessionId);
    }
    /** Mark a session archived; a later disposal must not send a second stop. */
    setArchived(sessionId, archived) {
        const state = this.states.get(sessionId);
        if (state !== undefined)
            state.archived = archived;
    }
    /** Drop a session whose lifecycle ended before it ever carried a request. */
    forgetSession(sessionId) {
        const state = this.states.get(sessionId);
        if (state?.lastModel === undefined)
            this.states.delete(sessionId);
    }
    /** Read the lifecycle facts a host needs to build a hint. */
    facts(sessionId) {
        const state = sessionId === undefined ? undefined : this.states.get(sessionId);
        return {
            seeded: state?.seeded ?? false,
            firstOrdinarySent: state?.firstOrdinarySent ?? false,
            parentSessionId: state?.parentSessionId,
        };
    }
    /** Model last used by this session, when the coordinator has seen one. */
    lastModelOf(sessionId) {
        return this.states.get(sessionId)?.lastModel;
    }
    /** Whether the host marked this session archived. */
    isArchived(sessionId) {
        return this.states.get(sessionId)?.archived ?? false;
    }
    // -------------------------------------------------------------- request path
    /**
     * Wait out any in-flight cache mutation for this session.
     *
     * Bounded and fail-open for the advisory path: when the cap expires the
     * caller continues unless a mutating verb is still outstanding or the
     * session is already quarantined, in which case the barrier is raised.
     *
     * @throws AgentHintError `CONTROL_BARRIER` when the session cannot safely proceed.
     */
    async awaitPendingOp(sessionId, signal) {
        const state = sessionId === undefined ? undefined : this.states.get(sessionId);
        if (state === undefined)
            return;
        const combined = signal === undefined ? this.signal : AbortSignal.any([signal, this.signal]);
        combined.throwIfAborted();
        let timer;
        let onAbort;
        const deadline = new Promise((resolve, reject) => {
            timer = setTimeout(() => resolve('expired'), this.pendingOpAwaitMs);
            onAbort = () => reject(combined.reason);
            combined.addEventListener('abort', onAbort, { once: true });
        });
        try {
            while (state.pendingOp !== undefined) {
                const pending = state.pendingOp;
                if (await Promise.race([pending, deadline]) === 'expired') {
                    this.options.warn?.('agenthint-core: control barrier timed out; backend outcome remains unknown');
                    if (state.mutations > 0 || state.unsafe)
                        throw controlBarrierError();
                    return;
                }
            }
            if (state.unsafe)
                throw controlBarrierError();
        }
        finally {
            clearTimeout(timer);
            if (onAbort !== undefined)
                combined.removeEventListener('abort', onAbort);
        }
    }
    /**
     * Reserve the stream slot for one ordinary request.
     *
     * Holds cache mutations until the returned release function runs, so a
     * `pause`/`stop` can never overtake an in-flight model stream. There is no
     * await between checking the mutation queue and reserving the slot, which is
     * what makes the exclusion real rather than best-effort.
     *
     * @throws AgentHintError `CONTROL_BARRIER` when the session cannot safely proceed.
     */
    async beginOrdinary(sessionId, model, signal) {
        this.signal.throwIfAborted();
        signal?.throwIfAborted();
        if (sessionId === undefined)
            return () => { };
        this.ensureResume(sessionId, model);
        await this.awaitPendingOp(sessionId, signal);
        this.signal.throwIfAborted();
        signal?.throwIfAborted();
        const state = this.state(sessionId);
        if (state.mutations > 0 || state.unsafe)
            throw controlBarrierError();
        state.generation++;
        // Keep the state associated with this lease even if disposal races acceptance.
        state.lastModel = model;
        if (state.active++ === 0)
            state.dataIdle = new Promise(resolve => { state.releaseData = resolve; });
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            if (--state.active === 0) {
                state.releaseData?.();
                state.releaseData = undefined;
                state.dataIdle = undefined;
            }
        };
    }
    /**
     * Commit the bookkeeping for an accepted ordinary request.
     *
     * Only call this once the transport confirms the request was accepted, so a
     * rejected request does not consume the session's single `start`.
     */
    noteOrdinaryRequest(sessionId, model) {
        if (sessionId === undefined || this.disposed)
            return;
        const state = this.state(sessionId);
        state.archived = false;
        state.firstOrdinarySent = true;
        state.lastModel = model;
        state.pausePending = false;
        state.pauseSent = false;
    }
    /**
     * Prepare one request end to end and return its lease.
     *
     * Convenience wrapper for hosts that hold a single hook: it performs the
     * barrier, builds the hint from current facts, and wires `accepted`/`finish`
     * to the bookkeeping above. Hosts with separate prepare and stream hooks (so
     * the lease must outlive preparation) should call
     * {@link beginOrdinary} and {@link buildHint} themselves.
     */
    async prepareRequest(facts) {
        const sessionId = facts.sessionId;
        const ordinary = facts.requestClass === 'ordinary';
        const state = sessionId === undefined ? undefined : this.state(sessionId);
        // 1. Pure validation first. Nothing has been acquired yet, so a bad input
        //    cannot leak a lease or wedge the session.
        const hint = this.buildHint(facts);
        // 2. Reserve the preparation slot *before* the first await. Checking and
        //    incrementing across an await would let two concurrent first requests
        //    both observe zero and both claim `start`.
        if (ordinary && state !== undefined) {
            if (!state.firstOrdinarySent && state.preparing > 0) {
                throw new AgentHintError('AgentHint: another ordinary request is already preparing this session; '
                    + 'a session admits one unaccepted first request at a time.', 'INVALID_INPUT');
            }
            state.preparing++;
        }
        // 3. Acquire the stream lease; roll the reservation back on any failure.
        let release;
        try {
            release = ordinary ? await this.beginOrdinary(sessionId, facts.model, facts.signal) : () => { };
        }
        catch (error) {
            if (ordinary && state !== undefined && state.preparing > 0)
                state.preparing--;
            throw error;
        }
        let phase = 'preparing';
        let settled = false;
        const settlePreparation = () => {
            if (settled)
                return;
            settled = true;
            if (ordinary && state !== undefined && state.preparing > 0)
                state.preparing--;
        };
        return {
            hint,
            accepted: () => {
                // A finished lease must not commit state: cancellation and a late
                // acceptance can otherwise race and consume a `start` nobody sent.
                if (phase !== 'preparing')
                    return;
                phase = 'accepted';
                if (ordinary)
                    this.noteOrdinaryRequest(sessionId, facts.model);
                settlePreparation();
            },
            finish: () => {
                if (phase === 'finished')
                    return;
                phase = 'finished';
                release();
                settlePreparation();
            },
        };
    }
    /** Build the wire field for one request from current session facts. */
    buildHint(facts) {
        // An unrecognised class must not silently fall through as "ordinary": the
        // coordinator would skip the stream lease while the builder still emitted a
        // `start`, so the two modules would disagree about the same request.
        if (facts.requestClass !== 'ordinary' && facts.requestClass !== 'background') {
            throw new AgentHintError(`AgentHint: unknown requestClass ${JSON.stringify(facts.requestClass)}; `
                + "expected 'ordinary' or 'background'.", 'INVALID_INPUT');
        }
        const view = this.facts(facts.sessionId);
        const inputs = {
            sessionId: facts.sessionId,
            requestClass: facts.requestClass,
            parentSessionId: view.parentSessionId,
            cacheControl: facts.cacheControl,
            seeded: view.seeded,
            firstOrdinarySent: view.firstOrdinarySent,
        };
        return buildAgentHint(inputs);
    }
    // ------------------------------------------------------------------ control
    /**
     * Ask for an advisory prefetch, at most once per pause cycle.
     *
     * Advisory means a failure is not fatal: the request may proceed, but the
     * caller must not report the prefetch as completed.
     */
    ensureResume(sessionId, model) {
        if (sessionId === undefined || this.disposed)
            return;
        const state = this.states.get(sessionId);
        if (state === undefined || !(state.seeded || state.pauseSent) || state.resumeSent
            || state.unsafe || this.now() < state.nextResumeAt)
            return;
        state.resumeSent = true;
        state.resumeAttempt = {};
        state.lastModel = model;
        void this.track(sessionId, 'resume', model);
    }
    /**
     * Defer a `pause` until the session is idle.
     *
     * The host decides *when* the foreground moved away; this method decides
     * *when it is safe to send*, which is the part that needs the queue.
     */
    requestPause(sessionId, model) {
        const state = this.states.get(sessionId);
        if (state === undefined || state.pauseSent || state.pausePending)
            return;
        state.pausePending = true;
        if (model !== undefined)
            state.lastModel = model;
        this.maybePauseIfIdle(sessionId);
    }
    /**
     * Send one mutating or advisory verb immediately through the session queue.
     *
     * Mutating verbs (`pause`, `compact`, `stop`) are never retried and a
     * `cancelled` result that already left the process counts as an unknown
     * outcome. Only `resume` retries, and only on an explicit transient
     * rejection.
     */
    requestControl(intent) {
        if (this.disposed)
            return Promise.resolve({ status: 'cancelled', dispatched: false });
        const state = this.states.get(intent.sessionId);
        if (state === undefined)
            return Promise.resolve({ status: 'cancelled', dispatched: false });
        if (state.lastModel === undefined && intent.model === undefined) {
            return Promise.resolve({ status: 'cancelled', dispatched: false });
        }
        return this.track(intent.sessionId, intent.verb, intent.model);
    }
    /** Send a terminal `stop`, then drop the state once it settles safely. */
    releaseSession(sessionId) {
        const state = this.states.get(sessionId);
        if (state?.lastModel === undefined) {
            this.states.delete(sessionId);
            return;
        }
        const incarnation = state.incarnation;
        const pending = state.archived
            ? state.pendingOp ?? Promise.resolve()
            : this.track(sessionId, 'stop', state.lastModel);
        void pending.then(() => {
            // Unknown mutation outcomes remain quarantined even if the session reopens.
            if (this.states.get(sessionId) === state && state.incarnation === incarnation && !state.unsafe) {
                this.states.delete(sessionId);
            }
        });
    }
    /** Archive a session: stop it once, and make a later disposal a no-op. */
    archiveSession(sessionId) {
        const state = this.states.get(sessionId);
        if (state?.lastModel === undefined || state.archived)
            return;
        state.archived = true;
        state.pausePending = false;
        state.pauseSent = true;
        state.resumeSent = false;
        void this.track(sessionId, 'stop', state.lastModel);
    }
    // ------------------------------------------------------------------ internals
    maybePauseIfIdle(sessionId) {
        const state = this.states.get(sessionId);
        if (state === undefined || !state.pausePending || !state.idle)
            return;
        state.pausePending = false;
        state.pauseSent = true;
        state.resumeSent = false;
        void this.track(sessionId, 'pause', state.lastModel);
    }
    state(sessionId) {
        let state = this.states.get(sessionId);
        if (state === undefined) {
            state = freshState();
            this.states.set(sessionId, state);
        }
        return state;
    }
    track(sessionId, verb, model) {
        if (this.disposed)
            return Promise.resolve({ status: 'cancelled', dispatched: false });
        const state = this.state(sessionId);
        const generation = state.generation;
        const resumeAttempt = state.resumeAttempt;
        const mutating = verb !== 'resume';
        if (mutating)
            state.mutations++;
        const canSend = () => !this.disposed && !state.unsafe && state.generation === generation;
        const dispatch = () => canSend()
            ? this.options.transport.send({
                verb, sessionId, model: model ?? state.lastModel ?? 'default', signal: this.signal, canSend,
            })
            : Promise.resolve({ status: 'cancelled', dispatched: false });
        const dependencies = [state.pendingOp, state.dataIdle].filter((value) => value !== undefined);
        const promise = dependencies.length === 0 ? dispatch() : Promise.all(dependencies).then(dispatch);
        const settled = promise.then((result) => {
            if (mutating && (result.status === 'unknown' || (result.status === 'cancelled' && result.dispatched))) {
                state.unsafe = true;
            }
            // A prefetch can fail after the advisory barrier already let data start.
            // Its own attempt identity, rather than the data generation, owns recovery.
            if (verb === 'resume' && state.resumeAttempt === resumeAttempt
                && (result.status === 'failed' || (result.status === 'cancelled' && !result.dispatched))) {
                state.resumeSent = false;
                state.nextResumeAt = this.now() + this.resumeCooldownMs;
            }
            return result;
        }, (error) => {
            // A transport that throws cannot prove the command was never dispatched.
            // Reporting `failed` would invite a caller to retry a mutation that may
            // already have run, so surface the same uncertainty the quarantine uses.
            if (mutating)
                state.unsafe = true;
            this.options.warn?.('agenthint-core: control operation failed', error);
            return { status: 'unknown' };
        });
        const tracked = settled.then(() => { }, () => { }).finally(() => {
            if (mutating)
                state.mutations--;
            if (state.pendingOp === tracked)
                state.pendingOp = undefined;
        });
        state.pendingOp = tracked;
        return settled;
    }
}
/** Re-exported so adapters can branch on the barrier without importing errors. */
export { AgentHintError };
