/**
 * Register the `deepseek-agent-hint` route: Chat or DeepSeek Messages aimed
 * at a MindIE-Motor coordinator, whose ordinary requests carry the `agent_hint`
 * field (session identity, optional fork lineage, optional cache policy) and
 * whose session lifecycle events plus the first ordinary request of a seeded
 * session drive `session_control` manage requests
 * (`resume`/`pause`/`compact`/`stop`) against the coordinator chat-completions
 * infer endpoint.
 *
 * The endpoint and model catalog fall back to the sibling DeepSeek route, so an
 * operator using a compatible backend avoids duplicate configuration. Messages
 * uses the official pipeline; Chat owns its protocol mapping and model contract;
 * connection facts resolve per request. Credentials may inherit only for the
 * same endpoint. Prefetch is advisory; pending or unknown cache mutations
 * block new ordinary requests in the affected session.
 * @module @deepseek-ai/dsh-llm-agent-hint
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
export { buildAgentHint } from './agent-hint.ts';
export type { AgentHintInputs } from './agent-hint.ts';
export { BASE_URL_ENV, Config, DEFAULT_BASE_URL, DEFAULT_PROVIDER, NO_INHERITED_CONNECTION, plainOptions, resolveAdapterOptions, resolveBaseURL, resolveModels } from './config.ts';
export type { AgentHintConfig, InheritedConnection, Options, ResolvedAgentHintOptions, SessionControlConfig } from './config.ts';
export { INHERIT_SOURCE_ID, readInheritedConnection } from './inherited-connection.ts';
export { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS, SessionControlClient } from './control-client.ts';
export type { ControlResult, ControlConnection, ControlWarnSink, SessionControlClientOptions } from './control-client.ts';
export { agentHintPrepareExtensions } from './extension.ts';
export type { AgentHintExtensionOptions } from './extension.ts';
export { ControlBarrierError, DEFAULT_PENDING_OP_AWAIT_MS, LifecycleBridge } from './lifecycle-bridge.ts';
export type { BridgeWarnSink, LifecycleBridgeOptions } from './lifecycle-bridge.ts';
export type { AgentHintCacheControl, AgentHintWire, SessionControlVerb } from './types.ts';
export declare const name = "llm-agent-hint";
export declare const inject: string[];
export declare function apply(ctx: Context, config: Config): void;
