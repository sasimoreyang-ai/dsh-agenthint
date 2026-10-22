/** Keep the session's mutation exclusion lease for the entire model stream. */
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekAdapterOptions, DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { GenerateOptions, StreamChunk, PreparedAdapterCall } from '@deepseek-ai/dsh-llm'
import type { LifecycleBridge } from './lifecycle-bridge.ts'

export class AgentHintAdapter<C extends DeepSeekConnectionOptions> extends DeepSeekAdapter<C> {
  constructor(dependencies: DeepSeekAdapterOptions<C>, private readonly bridge?: LifecycleBridge, private readonly lifetime?: AbortSignal) { super(dependencies) }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await super.prepareCall(provider, model, signal)
    return { model: prepared.model, stream: options => this.leased(options, scoped => prepared.stream(scoped)) }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* this.leased(options, scoped => super.stream(scoped))
  }
  private async *leased(options: GenerateOptions, stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const bridge = this.bridge
    const signals = [options.signal, bridge?.signal, this.lifetime].filter((value): value is AbortSignal => value !== undefined)
    const signal = signals.length ? AbortSignal.any(signals) : undefined
    signal?.throwIfAborted()
    const release = options.purpose === undefined ? await bridge?.beginOrdinary(options.sessionId, options.model, signal) : undefined
    try { yield* stream({ ...options, signal }) } finally { release?.() }
  }
}
