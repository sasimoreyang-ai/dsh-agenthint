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
import { AgentHintError } from './errors.ts';
import type { ControlIntent, ControlResult, ControlTransport, WarnSink } from './transport.ts';
import type { AgentHintCacheControl, AgentHintWire, RequestClass } from './types.ts';
/** Default bound on how long a request waits for an in-flight mutation. */
export declare const DEFAULT_PENDING_OP_AWAIT_MS = 2000;
/** Default cool-down before a failed advisory prefetch may be re-requested. */
export declare const DEFAULT_RESUME_COOLDOWN_MS = 1000;
/** Facts a host supplies when it learns a session exists. */
export interface SessionFacts {
    /** Host-side session identity, already namespaced by the host's own scope. */
    sessionId: string;
    /** Whether the session was created with prior history (resume/fork/replay). */
    seeded: boolean;
    /** Identity of the session this one continues, when the host knows it. */
    parentSessionId?: string | undefined;
}
/** Read-only lifecycle view a host needs to build a hint. */
export interface SessionFactsView {
    seeded: boolean;
    firstOrdinarySent: boolean;
    parentSessionId: string | undefined;
}
/** Per-request facts a host supplies before it serialises a model call. */
export interface RequestFacts {
    /** Session identity; `undefined` requests stay unprefixed and unqueued. */
    sessionId?: string | undefined;
    /** Host classification of the call. */
    requestClass: RequestClass;
    /** The real model this request targets. */
    model: string;
    /** Caller cancellation. */
    signal?: AbortSignal | undefined;
    /** Static cache policy copied verbatim into every hint. */
    cacheControl?: AgentHintCacheControl | undefined;
}
/** Coordinator options. Every external effect is injectable for testing. */
export interface HintCoordinatorOptions {
    /** Where control commands go. */
    transport: ControlTransport;
    /** Bound on the mutation barrier; defaults to {@link DEFAULT_PENDING_OP_AWAIT_MS}. */
    pendingOpAwaitMs?: number;
    /** Cool-down after an advisory prefetch failure. */
    resumeCooldownMs?: number;
    /** Non-fatal diagnostics. */
    warn?: WarnSink;
    /** Injectable clock for deterministic tests. */
    now?: () => number;
}
/** Handle for one in-flight ordinary request. */
export interface RequestLease {
    /** Wire field to merge into the request body, when the request carries one. */
    hint?: AgentHintWire | undefined;
    /**
     * Commit the `start` bookkeeping. Call exactly once, at the point the host
     * knows the request was accepted — never during preparation.
     */
    accepted(): void;
    /**
     * Release the stream lease. Idempotent; must run on every terminal path
     * (completion, error, cancellation, abandoned iterator).
     */
    finish(): void;
}
/**
 * Coordinates AgentHint control state for one trust scope.
 *
 * Create one instance per isolated interaction scope (single-user runtime,
 * one workspace, one agent instance). Sharing one instance across users would
 * let one user's traffic pause another user's session, so hosts that serve
 * several scopes must hold several coordinators.
 */
export declare class HintCoordinator {
    private readonly options;
    private readonly states;
    private disposed;
    private readonly lifetime;
    private readonly pendingOpAwaitMs;
    private readonly resumeCooldownMs;
    private readonly now;
    constructor(options: HintCoordinatorOptions);
    /** Aborted when the coordinator is disposed. */
    get signal(): AbortSignal;
    /** Whether {@link dispose} has run. */
    get isDisposed(): boolean;
    /**
     * Stop all work. Cancels waits and in-flight sends; no new control command is
     * produced afterwards. Outstanding uncertainty is intentionally not cleared:
     * a disposed coordinator must not be read as "the backend is safe".
     */
    dispose(): void;
    /**
     * Record that a session exists.
     *
     * Outstanding operations and uncertainty are deliberately preserved across a
     * disposal/reopen cycle: a reopened session must not look safe just because
     * its previous incarnation ended.
     */
    registerSession(facts: SessionFacts): void;
    /** Report whether the host considers this session idle (no turn in flight). */
    setAgentIdle(sessionId: string, idle: boolean): void;
    /** Mark a session archived; a later disposal must not send a second stop. */
    setArchived(sessionId: string, archived: boolean): void;
    /** Drop a session whose lifecycle ended before it ever carried a request. */
    forgetSession(sessionId: string): void;
    /** Read the lifecycle facts a host needs to build a hint. */
    facts(sessionId: string | undefined): SessionFactsView;
    /** Model last used by this session, when the coordinator has seen one. */
    lastModelOf(sessionId: string): string | undefined;
    /** Whether the host marked this session archived. */
    isArchived(sessionId: string): boolean;
    /**
     * Wait out any in-flight cache mutation for this session.
     *
     * Bounded and fail-open for the advisory path: when the cap expires the
     * caller continues unless a mutating verb is still outstanding or the
     * session is already quarantined, in which case the barrier is raised.
     *
     * @throws AgentHintError `CONTROL_BARRIER` when the session cannot safely proceed.
     */
    awaitPendingOp(sessionId: string | undefined, signal?: AbortSignal): Promise<void>;
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
    beginOrdinary(sessionId: string | undefined, model: string, signal?: AbortSignal): Promise<() => void>;
    /**
     * Commit the bookkeeping for an accepted ordinary request.
     *
     * Only call this once the transport confirms the request was accepted, so a
     * rejected request does not consume the session's single `start`.
     */
    noteOrdinaryRequest(sessionId: string | undefined, model: string): void;
    /**
     * Prepare one request end to end and return its lease.
     *
     * Convenience wrapper for hosts that hold a single hook: it performs the
     * barrier, builds the hint from current facts, and wires `accepted`/`finish`
     * to the bookkeeping above. Hosts with separate prepare and stream hooks (so
     * the lease must outlive preparation) should call
     * {@link beginOrdinary} and {@link buildHint} themselves.
     */
    prepareRequest(facts: RequestFacts): Promise<RequestLease>;
    /** Build the wire field for one request from current session facts. */
    buildHint(facts: RequestFacts): AgentHintWire | undefined;
    /**
     * Ask for an advisory prefetch, at most once per pause cycle.
     *
     * Advisory means a failure is not fatal: the request may proceed, but the
     * caller must not report the prefetch as completed.
     */
    ensureResume(sessionId: string | undefined, model: string): void;
    /**
     * Defer a `pause` until the session is idle.
     *
     * The host decides *when* the foreground moved away; this method decides
     * *when it is safe to send*, which is the part that needs the queue.
     */
    requestPause(sessionId: string, model?: string): void;
    /**
     * Send one mutating or advisory verb immediately through the session queue.
     *
     * Mutating verbs (`pause`, `compact`, `stop`) are never retried and a
     * `cancelled` result that already left the process counts as an unknown
     * outcome. Only `resume` retries, and only on an explicit transient
     * rejection.
     */
    requestControl(intent: ControlIntent): Promise<ControlResult>;
    /** Send a terminal `stop`, then drop the state once it settles safely. */
    releaseSession(sessionId: string): void;
    /** Archive a session: stop it once, and make a later disposal a no-op. */
    archiveSession(sessionId: string): void;
    private maybePauseIfIdle;
    private state;
    private track;
}
/** Re-exported so adapters can branch on the barrier without importing errors. */
export { AgentHintError };
