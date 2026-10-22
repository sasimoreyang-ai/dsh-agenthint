/**
 * DSH adapter over the host-neutral coordinator.
 *
 * The queue, the barrier, the stream lease and the unknown-mutation quarantine
 * all live in `@sasimoreyang-ai/agenthint-core`. This module supplies the three
 * things only DSH can know:
 *
 * 1. **Event mapping** — which DSH events mean "the user moved away", "the
 *    compaction committed", "the session really ended".
 * 2. **Scope-local foreground tracking** — `lastOrdinarySessionId` decides which
 *    session to pause when the user switches chats. It is intentionally held
 *    here, not in the core: a shared runtime must not let one user's traffic
 *    pause another user's session, so each host scope owns its own instance.
 * 3. **Error translation** — the core raises `AgentHintError`; DSH callers
 *    expect `LlmError` with the `CONTROL_BARRIER` code, which must never be
 *    downgraded into a retryable transport failure.
 *
 * @module dsh-llm-agent-hint/lifecycle-bridge
 */
import type { Context } from '@deepseek-ai/cordis';
import type { AgentStatus } from '@deepseek-ai/dsh-agent';
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { DEFAULT_PENDING_OP_AWAIT_MS } from '../vendor/agenthint-core/index.js';
import type { ControlResult, SessionControlClient } from './control-client.ts';
import type { SessionControlVerb } from './types.ts';
export { DEFAULT_PENDING_OP_AWAIT_MS };
/** Sink for non-fatal bridge diagnostics. */
export interface BridgeWarnSink {
    (message: string, error?: unknown): void;
}
/** Constructor options; mirrors the pre-split bridge exactly. */
export interface LifecycleBridgeOptions {
    client: SessionControlClient;
    pendingOpAwaitMs: number;
    warn?: BridgeWarnSink;
}
/**
 * Raised when a session cannot safely start another request because a cache
 * mutation is pending or its outcome is unknown.
 *
 * Extends the host error so callers can keep catching `LlmError`, but carries a
 * distinct code so no host-level retry policy treats it as a transport blip.
 */
export declare class ControlBarrierError extends LlmError {
    constructor();
}
export declare class LifecycleBridge {
    private readonly options;
    private readonly core;
    /** Scope-local: which session the user last used in this host instance. */
    private lastOrdinarySessionId;
    private disposed;
    constructor(options: LifecycleBridgeOptions);
    /** Aborted when the bridge is disposed. */
    get signal(): AbortSignal;
    /** Wire DSH lifecycle events into the coordinator. */
    subscribe(ctx: Context): void;
    dispose(): void;
    /** Lifecycle facts the data plane needs to build a hint. */
    facts(sessionId: SessionId | undefined): {
        seeded: boolean;
        firstOrdinarySent: boolean;
        parentSessionId: SessionId | undefined;
    };
    /** Prefetch is advisory. Pending/unknown mutations must not race new inference. */
    awaitPendingOp(sessionId: SessionId | undefined, signal?: AbortSignal): Promise<void>;
    /** Hold mutations until the actual model stream finishes, errors or is cancelled. */
    beginOrdinary(sessionId: SessionId | undefined, model: string, signal?: AbortSignal): Promise<() => void>;
    /** Commit `start` bookkeeping for an accepted ordinary request. */
    noteOrdinaryRequest(sessionId: SessionId | undefined, model: string): void;
    onSessionCreated(session: Session): void;
    ensureResume(sessionId: SessionId | undefined, model: string): void;
    onAgentStatus(sessionId: SessionId, status: AgentStatus): void;
    onSessionComposing(sessionId: SessionId): void;
    onSessionEvent(session: Session, event: SessionEvent): void;
    onSessionDisposed(session: Session): void;
    onSessionArchived(sessionId: SessionId): void;
    onSessionUnarchived(sessionId: SessionId): void;
}
/** Re-exported for callers that previously imported it from this module. */
export type { ControlResult, SessionControlVerb };
