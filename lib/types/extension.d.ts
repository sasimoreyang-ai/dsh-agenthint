/**
 * The data-plane half of the `agent_hint` feature: a `prepareExtensions`
 * implementation for the DeepSeek Messages adapter that injects the
 * `agent_hint` field into ordinary requests of the `deepseek-agent-hint`
 * route. The registered adapter holds a full-stream mutation exclusion lease.
 * Standalone extension callers get a bounded preparation barrier; pending or
 * unknown mutations block, while resume prefetch remains advisory.
 * `noteOrdinaryRequest` rides the extension `accept` transaction, so only a
 * request the endpoint actually accepted advances the `start` bookkeeping.
 *
 * @module dsh-llm-agent-hint/extension
 */
import type { DeepSeekLlmApiExtensionRequest, PreparedDeepSeekLlmApiExtensions } from '@deepseek-ai/dsh-deepseek-llm-api-extensions';
import type { LifecycleBridge } from './lifecycle-bridge.ts';
import type { AgentHintCacheControl } from './types.ts';
/** Request-local dependencies for {@link agentHintPrepareExtensions}. */
export interface AgentHintExtensionOptions {
    /** The registry chain this route still composes with (usually the global `deepseekLlmApiExtensions` service). */
    chained: (request: DeepSeekLlmApiExtensionRequest) => Promise<PreparedDeepSeekLlmApiExtensions>;
    /** Lifecycle control plane; omission suppresses the automatic `start` declaration. */
    bridge?: LifecycleBridge | undefined;
    /** The adapter has already acquired a full-stream lease and performed the barrier. */
    streamLease?: boolean;
    /** Static coordinator cache policy copied verbatim into every hint. */
    cacheControl?: AgentHintCacheControl | undefined;
}
/**
 * Build the route's `prepareExtensions`: barrier, hint construction, and
 * chained field preparation, with `start` bookkeeping committed on accept.
 * @param options - the chain to compose with and the optional control plane.
 * @returns a `prepareExtensions` implementation for `DeepSeekAdapterOptions`.
 */
export declare function agentHintPrepareExtensions(options: AgentHintExtensionOptions): (request: DeepSeekLlmApiExtensionRequest) => Promise<PreparedDeepSeekLlmApiExtensions>;
