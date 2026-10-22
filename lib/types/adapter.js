/** Keep the session's mutation exclusion lease for the entire model stream. */
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek';
export class AgentHintAdapter extends DeepSeekAdapter {
    bridge;
    lifetime;
    constructor(dependencies, bridge, lifetime) {
        super(dependencies);
        this.bridge = bridge;
        this.lifetime = lifetime;
    }
    async prepareCall(provider, model, signal) {
        const prepared = await super.prepareCall(provider, model, signal);
        return { model: prepared.model, stream: options => this.leased(options, scoped => prepared.stream(scoped)) };
    }
    async *stream(options) {
        yield* this.leased(options, scoped => super.stream(scoped));
    }
    async *leased(options, stream) {
        const bridge = this.bridge;
        const signals = [options.signal, bridge?.signal, this.lifetime].filter((value) => value !== undefined);
        const signal = signals.length ? AbortSignal.any(signals) : undefined;
        signal?.throwIfAborted();
        const release = options.purpose === undefined ? await bridge?.beginOrdinary(options.sessionId, options.model, signal) : undefined;
        try {
            yield* stream({ ...options, signal });
        }
        finally {
            release?.();
        }
    }
}
