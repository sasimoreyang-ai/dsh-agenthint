/** Chat Completions transport with lossless roles, bounded streams and session leases. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm';
import type { DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek';
import type { AgentHintWire } from './types.ts';
import type { LifecycleBridge } from './lifecycle-bridge.ts';
export interface ChatConnectionOptions {
    baseURL: string;
    maxTokens?: number;
    models?: DeepSeekConnectionOptions['models'];
    defaultContextWindow?: number;
    defaults?: DeepSeekConnectionOptions['defaults'];
    streamIdleTimeoutMs?: number;
    retryPolicy?: ResolvedRetryPolicy;
}
export interface ChatRequestFacts {
    sessionId: string | undefined;
    purpose: GenerateOptions['purpose'];
    model: string;
    signal: AbortSignal;
}
export interface ChatAdapterDependencies<C extends ChatConnectionOptions = ChatConnectionOptions> {
    options(): C;
    providerName?: string;
    /** Authentication must resolve from this exact connection, never current options(). */
    resolveAuth(connection: C): Promise<{
        headers: Record<string, string>;
    }>;
    prepareHint?(request: ChatRequestFacts): AgentHintWire | undefined | Promise<AgentHintWire | undefined>;
    onAccepted?(request: ChatRequestFacts): void;
    bridge?: LifecycleBridge;
    /** Plugin lifetime, including when lifecycle controls are disabled. */
    signal?: AbortSignal;
    /** Kept for consumers constructing this adapter directly. */
    discoverModels?(provider: string): readonly LlmModelInfo[] | Promise<readonly LlmModelInfo[]>;
}
/** Shared by data and control planes; a /v1 root is never duplicated. */
export declare function chatCompletionsURL(baseURL: string): string;
export declare class ChatCompletionsAdapter<C extends ChatConnectionOptions = ChatConnectionOptions> extends LlmAdapter {
    private readonly dependencies;
    constructor(dependencies: ChatAdapterDependencies<C>);
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    providerRetryPolicy(_provider: string): ResolvedRetryPolicy;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private generate;
    private request;
}
