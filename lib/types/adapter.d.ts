/** Keep the session's mutation exclusion lease for the entire model stream. */
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek';
import type { DeepSeekAdapterOptions, DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek';
import type { GenerateOptions, StreamChunk, PreparedAdapterCall } from '@deepseek-ai/dsh-llm';
import type { LifecycleBridge } from './lifecycle-bridge.ts';
export declare class AgentHintAdapter<C extends DeepSeekConnectionOptions> extends DeepSeekAdapter<C> {
    private readonly bridge?;
    private readonly lifetime?;
    constructor(dependencies: DeepSeekAdapterOptions<C>, bridge?: LifecycleBridge | undefined, lifetime?: AbortSignal | undefined);
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private leased;
}
