/**
 * HTTP implementation of the control transport for the coordinator protocol.
 *
 * This sub-entry is optional: the coordinator itself only needs a
 * {@link ControlTransport}. Import this module when your backend speaks the
 * current coordinator protocol — an empty-messages chat-completions request
 * carrying `agent_hint.session_control`.
 *
 * Credentials, the endpoint and any attribution headers are resolved **once
 * per command** into an immutable snapshot, so a configuration change midway
 * through a request cannot send a control command to a different origin than
 * the one the caller authorised.
 *
 * @module agenthint-core/http
 */
import type { ControlCommand, ControlResult, ControlTransport, WarnSink } from '../transport.ts';
/** Immutable connection facts captured for one command. */
export interface ControlConnectionSnapshot {
    /** Absolute URL of the control endpoint. */
    endpoint: string;
    /** Credential value, when the endpoint requires one. */
    apiKey?: string | undefined;
    /** Header the credential is sent in. Defaults to `authorization` (Bearer). */
    authHeader?: 'authorization' | 'x-api-key' | undefined;
    /** Extra headers, typically host attribution or tracing fields. */
    headers?: Record<string, string> | undefined;
}
/** Options for {@link HttpControlTransport}. */
export interface HttpControlTransportOptions {
    /**
     * Capture endpoint, credential and headers in one snapshot. Preferred: it
     * makes the single-source-of-truth requirement explicit.
     */
    resolveConnection?: () => Promise<ControlConnectionSnapshot>;
    /** Endpoint used when {@link resolveConnection} is not supplied. */
    endpoint?: string;
    /** Credential resolver used when {@link resolveConnection} is not supplied. */
    resolveApiKey?: () => Promise<string | undefined>;
    /** Header the credential is sent in. Defaults to `authorization` (Bearer). */
    authHeader?: 'authorization' | 'x-api-key' | undefined;
    /** Extra headers appended to every control request. */
    headers?: () => Record<string, string>;
    /** Model named in the manage request when the command omits one. */
    defaultModel: string;
    /** Per-attempt timeout. Defaults to 5 s. */
    timeoutMs?: number;
    /** Extra attempts, allowed for `resume` only. Defaults to 1. */
    retries?: number;
    /** Non-fatal diagnostics. */
    warn?: WarnSink;
    /** Injectable fetch, for tests and non-Node runtimes. */
    fetchImpl?: typeof fetch;
}
/** Default per-attempt control timeout. */
export declare const DEFAULT_CONTROL_TIMEOUT_MS = 5000;
/** Default extra attempts for advisory prefetch. */
export declare const DEFAULT_CONTROL_RETRIES = 1;
/**
 * Sends control verbs to a coordinator over HTTP.
 *
 * Retry policy is deliberately asymmetric. A mutating verb (`pause`, `stop`,
 * `compact`) that timed out or returned 5xx may already have executed, so it is
 * reported as `unknown` and never resent; the coordinator quarantines the
 * session until an operator resolves it. `resume` only prefetches, so an
 * explicit transient rejection is retried a bounded number of times.
 */
export declare class HttpControlTransport implements ControlTransport {
    private readonly options;
    private readonly timeoutMs;
    private readonly retries;
    private readonly fetchImpl;
    constructor(options: HttpControlTransportOptions);
    send(command: ControlCommand): Promise<ControlResult>;
    private attempt;
}
