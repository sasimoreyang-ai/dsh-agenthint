/**
 * `SessionControlClient`: one-way, best-effort session-lifecycle manage
 * requests against a MindIE-Motor coordinator's OpenAI-compatible infer
 * endpoint. The wire contract is the coordinator's own: an empty-messages
 * chat-completions request whose `agent_hint.session_control` verb the
 * coordinator translates into a context-management operation (`pause`→
 * offload, `stop`/`compact`→evict, `resume`→prefetch). Control requests are
 * advisory by design — a failed one logs a warning and never rejects the
 * harness work that triggered it.
 *
 * @module dsh-llm-agent-hint/control-client
 */
import type { SessionControlVerb } from './types.ts';
/** Sink for the warnings a best-effort control request may produce. */
export interface ControlWarnSink {
    /** Report one swallowed control-request failure. */
    (message: string, error?: unknown): void;
}
/** Validated facts for the control plane; resolved once per plugin load. */
export interface SessionControlClientOptions {
    /** Optional atomic connection snapshot, retained across this operation's retries. */
    resolveConnection?: () => Promise<{
        endpoint: string;
        apiKey: string | undefined;
    }>;
    /** Full manage-request URL; the coordinator's chat-completions infer endpoint. */
    endpoint: string;
    /** Resolves the bearer token for one manage request; `undefined` sends it unauthenticated. */
    resolveApiKey: () => Promise<string | undefined>;
    /** Served model id carried on manage requests; any served id is accepted. */
    model: string;
    /** Per-request timeout in milliseconds. */
    timeoutMs: number;
    /** Transport-level retries after the first failed attempt. */
    retries: number;
    /** Warning sink; defaults to silent. */
    warn?: ControlWarnSink;
}
/** Default control-request timeout. */
export declare const DEFAULT_CONTROL_TIMEOUT_MS = 5000;
/** Default transport-level retries for one control request. */
export declare const DEFAULT_CONTROL_RETRIES = 1;
/**
 * Fire one `agent_hint.session_control` manage request. Never rejects: every
 * failure path — transport, timeout, non-2xx — resolves after logging a
 * warning through the configured sink, because session control must not turn
 * a harness lifecycle event into a user-visible error.
 */
export declare class SessionControlClient {
    private readonly options;
    constructor(options: SessionControlClientOptions);
    /**
     * Send one verb for one session.
     * @param verb - the lifecycle verb; `start` is a data-plane piggyback only
     *   and is rejected here because an empty-messages `start` request has no
     *   coordinator-side effect.
     * @param sessionId - the coordinator session identity.
     * @param model - the session's last ordinary-request model, when one was
     *   observed; omitted falls back to the configured default.
     * @param signal - optional caller cancellation for the attempt sequence.
     */
    send(verb: SessionControlVerb, sessionId: string, model?: string, signal?: AbortSignal): Promise<void>;
    private attempt;
}
