/**
 * DSH-facing control client.
 *
 * The transport itself — snapshot semantics, retry asymmetry, body draining —
 * lives in `@sasimoreyang-ai/agenthint-core/http`. This module keeps the DSH
 * contract: the exported name, constructor shape and `send` signature, plus the
 * attribution headers DSH adds to every outbound request.
 *
 * HTTP acceptance is not KV completion.
 *
 * @module dsh-llm-agent-hint/control-client
 */
import { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS } from '../vendor/agenthint-core/http/index.js';
import type { ControlResult } from '../vendor/agenthint-core/index.js';
import type { SessionControlVerb } from './types.ts';
export { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS };
export type { ControlResult };
/** Sink for non-fatal control diagnostics. */
export interface ControlWarnSink {
    (message: string, error?: unknown): void;
}
/** Immutable endpoint and credential facts captured for one command. */
export interface ControlConnection {
    endpoint: string;
    apiKey: string | undefined;
    authHeader?: 'authorization' | 'x-api-key';
}
/** Constructor options; mirrors the pre-split client exactly. */
export interface SessionControlClientOptions {
    resolveConnection?: () => Promise<ControlConnection>;
    endpoint: string;
    resolveApiKey: () => Promise<string | undefined>;
    model: string;
    timeoutMs: number;
    retries: number;
    warn?: ControlWarnSink;
}
/**
 * Sends control verbs to the coordinator on behalf of DSH.
 *
 * `start` is rejected here: it is a data-plane piggyback verb and must ride an
 * ordinary request, because a standalone empty-messages `start` has no effect
 * on the coordinator.
 */
export declare class SessionControlClient {
    private readonly transport;
    private readonly defaultModel;
    constructor(options: SessionControlClientOptions);
    /** No automatic retry of mutating verbs or ambiguous network outcomes. */
    send(verb: SessionControlVerb, sessionId: string, model?: string, signal?: AbortSignal, canSend?: () => boolean): Promise<ControlResult>;
}
