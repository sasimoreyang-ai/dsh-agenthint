/**
 * `LifecycleBridge`: the seam between harness session lifecycle events and
 * coordinator session-control verbs. `session/created` only records a seeded
 * session; the first ordinary request then requests the `resume` prefetch
 * through {@link ensureResume}. A change in the foreground session requests
 * a `pause` once the previous session reaches idle; a successful
 * `compaction/end` requests a `compact` (evict-and-rebuild),
 * `session/disposed` requests a terminal `stop` (evict), and
 * `workspace/session-archived` requests an advisory `stop`.
 * The bridge also tracks, per session, whether the first ordinary request
 * already carried the `start` declaration, and exposes a bounded fail-open
 * barrier (`awaitPendingOp`) so a request that races an in-flight manage
 * verb waits for it — up to a configured cap — before serialization.
 *
 * @module dsh-llm-agent-hint/lifecycle-bridge
 */
import type { Context } from '@deepseek-ai/cordis';
import type { AgentStatus } from '@deepseek-ai/dsh-agent';
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionControlClient } from './control-client.ts';
/** Warning sink shared with the control client. */
export interface BridgeWarnSink {
    /** Report one degraded bridge behavior (barrier timeout, send failure). */
    (message: string, error?: unknown): void;
}
/** Validated facts for the bridge; resolved once per plugin load. */
export interface LifecycleBridgeOptions {
    /** Best-effort manage-request transport. */
    client: SessionControlClient;
    /** Cap on how long a data-plane request waits for an in-flight verb. */
    pendingOpAwaitMs: number;
    /** Warning sink; defaults to silent. */
    warn?: BridgeWarnSink;
}
/** Default cap for the pre-serialization manage-verb barrier. */
export declare const DEFAULT_PENDING_OP_AWAIT_MS = 2000;
/**
 * Event-to-verb routing with per-session bookkeeping. One instance serves
 * the whole plugin lifetime; all Cordis listeners are registered through
 * {@link subscribe} so their disposers follow the plugin's own scope.
 */
export declare class LifecycleBridge {
    private readonly options;
    private readonly states;
    private lastOrdinarySessionId;
    private disposed;
    constructor(options: LifecycleBridgeOptions);
    /**
     * Register the six lifecycle listeners on one context.
     * @param ctx - context whose scope owns the listener disposers.
     */
    subscribe(ctx: Context): void;
    /** Drop all tracked state (plugin teardown). */
    dispose(): void;
    /**
     * The `agent_hint` facts of one session for the next ordinary request.
     * @param sessionId - session identity, when the request carries one.
     * @returns `seeded`, `firstOrdinarySent`, and fork-parent identity for
     * {@link buildAgentHint}.
     */
    facts(sessionId: SessionId | undefined): {
        seeded: boolean;
        firstOrdinarySent: boolean;
        parentSessionId: SessionId | undefined;
    };
    /**
     * Wait — up to the configured cap — for the session's in-flight manage
     * verb to settle. Fails open: a timeout resolves anyway with a warning,
     * because a slow control plane must never block an ordinary request.
     * @param sessionId - session identity, when the request carries one.
     */
    awaitPendingOp(sessionId: SessionId | undefined): Promise<void>;
    /**
     * Record one accepted ordinary request: flips `firstOrdinarySent` (so the
     * next request never re-declares `start`) and remembers the model id for
     * later manage requests. `seeded` stays a constructor fact: only
     * `session/created` sets it, so a live fresh session never earns a
     * `resume` prefetch between its consecutive ordinary requests.
     * @param sessionId - session identity; `undefined` requests are ignored.
     * @param model - model id reused by later manage requests.
     */
    noteOrdinaryRequest(sessionId: SessionId | undefined, model: string): void;
    /**
     * `session/created`: record whether the session carries prior history.
     * The actual `resume` prefetch is deferred to the first ordinary request
     * so automatic startup restores do not fan out one manage request each.
     * @param session - the freshly created session.
     */
    onSessionCreated(session: Session): void;
    /**
     * Whether the session surface already holds model-visible history, as
     * opposed to a blank persisted session whose log holds only its
     * `session/end-seed` marker. Only a conversation that ran a turn needs a
     * KV-cache `resume`; a blank session should still declare `start` on its
     * first request.
     */
    private hasSeededConversation;
    /**
     * Request the deferred `resume` prefetch once, just before the ordinary
     * request (or composer draft) that needs it. Fires only when the
     * coordinator's KV for the session may actually be gone: the session was
     * created with prior history (`seeded`), or it was previously `pause`d
     * (`pauseSent`). Anonymous, live-fresh, and already-resumed sessions no-op.
     * @param sessionId - the session the request belongs to.
     * @param model - the model id the resumed request will use.
     */
    ensureResume(sessionId: SessionId | undefined, model: string): void;
    /**
     * Track the live agent status so a pending pause fires only after the
     * switched-away session reaches idle.
     * @param sessionId - the agent/session identity whose status changed.
     * @param status - the status just entered.
     */
    onAgentStatus(sessionId: SessionId, status: AgentStatus): void;
    /**
     * The web composer started a draft in a session. This is the signal that a
     * paused historical session should be resumed before the user submits it.
     * @param sessionId - the session whose draft just became non-empty.
     */
    onSessionComposing(sessionId: SessionId): void;
    /**
     * `session/event`: a successful compaction asks the coordinator to evict and rebuild.
     * @param session - the session that emitted the event.
     * @param event - the lifecycle event; only `compaction/end` is acted on.
     */
    onSessionEvent(session: Session, event: SessionEvent): void;
    /**
     * `session/disposed`: terminal evict queued after prior controls; cleanup is generation-safe.
     * @param session - the session being disposed.
     */
    onSessionDisposed(session: Session): void;
    /**
     * `workspace/session-archived`: advisory evict. The session may stay live
     * and be unarchived later, so tracked state is kept.
     * @param sessionId - the session that just became archived.
     */
    onSessionArchived(sessionId: SessionId): void;
    /** Allow another archive cycle after the host successfully unarchives the session.
     * @param sessionId - the restored session identity.
     */
    onSessionUnarchived(sessionId: SessionId): void;
    private markForPause;
    private maybePauseIfIdle;
    private state;
    private track;
}
