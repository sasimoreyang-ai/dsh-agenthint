/** OpenAI chat/completions transport for the agent-hint route.
 *
 * The Messages transport loses `agent_hint` on engines whose Anthropic
 * entrypoint does not declare the field: the request model drops unknown keys
 * before the session-aware manager sees them, so lifecycle control silently
 * no-ops. The chat/completions entrypoint declares the field on those same
 * engines, so speaking that protocol keeps the hint intact without touching the
 * engine.
 *
 * @module dsh-llm-agent-hint/chat-adapter
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { AgentHintWire } from './types.ts';
/** Connection facts the owning plugin resolves per request. */
export interface ChatAdapterDependencies {
    /** Resolved endpoint and generation defaults for this generation. */
    options(): {
        baseURL: string;
        maxTokens?: number | undefined;
    };
    /** Provider label shown by selectors. */
    providerName?: string;
    /** Advisory model catalog for selectors. */
    discoverModels?(provider: string): readonly LlmModelInfo[] | Promise<readonly LlmModelInfo[]>;
    /** Auth headers for this generation; empty sends unauthenticated requests. */
    resolveAuth(): Promise<{
        headers: Record<string, string>;
    }>;
    /** Hint to merge into the body, or `undefined` to send none.
     *
     * Asynchronous so the caller can arm the control-plane barrier before the
     * request is serialized; the transport awaits it exactly once per call.
     */
    prepareHint?(request: {
        sessionId: string | undefined;
        purpose: GenerateOptions['purpose'];
    }): AgentHintWire | undefined | Promise<AgentHintWire | undefined>;
    /** Notified once the endpoint accepted the request, mirroring the extension `accept` transaction. */
    onAccepted?(request: {
        sessionId: string | undefined;
    }): void;
}
/** Adapter speaking the coordinator's OpenAI chat/completions entrypoint. */
export declare class ChatCompletionsAdapter extends LlmAdapter {
    #private;
    constructor(dependencies: ChatAdapterDependencies);
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
    prepareCall(provider: string, model: string): Promise<PreparedAdapterCall>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
