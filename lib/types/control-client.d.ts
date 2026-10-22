import type { SessionControlVerb } from './types.ts';
export type ControlResult = {
    status: 'accepted';
    httpStatus: number;
} | {
    status: 'failed';
    retryable: boolean;
    httpStatus?: number;
} | {
    status: 'unknown';
} | {
    status: 'cancelled';
    dispatched: boolean;
};
export interface ControlWarnSink {
    (message: string, error?: unknown): void;
}
export interface ControlConnection {
    endpoint: string;
    apiKey: string | undefined;
    authHeader?: 'authorization' | 'x-api-key';
}
export interface SessionControlClientOptions {
    resolveConnection?: () => Promise<ControlConnection>;
    endpoint: string;
    resolveApiKey: () => Promise<string | undefined>;
    model: string;
    timeoutMs: number;
    retries: number;
    warn?: ControlWarnSink;
}
export declare const DEFAULT_CONTROL_TIMEOUT_MS = 5000;
export declare const DEFAULT_CONTROL_RETRIES = 1;
export declare class SessionControlClient {
    private readonly options;
    constructor(options: SessionControlClientOptions);
    /** No automatic retry of mutating verbs or ambiguous network outcomes. */
    send(verb: SessionControlVerb, sessionId: string, model?: string, signal?: AbortSignal, canSend?: () => boolean): Promise<ControlResult>;
    private attempt;
}
