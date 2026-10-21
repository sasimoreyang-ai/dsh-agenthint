/** Plugin configuration and request-local resolution for the agent-hint route. */
import type { Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type CredentialRef } from '@deepseek-ai/dsh-credentials';
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment';
import type { Config as ProtocolConfig, DeepSeekConnectionOptions, Options as ProtocolOptions } from '@deepseek-ai/dsh-llm-deepseek';
import type { AgentHintCacheControl } from './types.ts';
/** The provider route this plugin owns; read at plugin load. */
export declare const DEFAULT_PROVIDER = "deepseek-agent-hint";
/** Coordinator Messages API root; the adapter appends `/v1/messages`. */
export declare const DEFAULT_BASE_URL = "http://127.0.0.1:1025";
/** Session lifecycle control plane configuration. */
export interface SessionControlConfig {
    /** `false` disables manage requests; the static data plane keeps working. */
    enabled: boolean;
    /** Install stock-host composer Remote and public archive observers. Default: true. */
    pluginTriggers?: boolean;
    /** Full manage-request URL; omission derives `<baseURL>/v1/chat/completions`. */
    endpoint?: string | undefined;
    /** Cap on how long an ordinary request waits for an in-flight verb. */
    pendingOpAwaitMs: number;
    /** Per-attempt control-request timeout in milliseconds. */
    controlTimeoutMs: number;
    /** Transport-level retries after the first failed attempt. */
    retries: number;
}
/** The two `agent_hint` planes: static hint injection and lifecycle control. */
export interface AgentHintConfig {
    /** Master switch for `agent_hint` injection; `false` degrades to plain Messages transport. */
    enabled: boolean;
    /** Static coordinator cache policy copied verbatim into every hint. */
    cacheControl?: AgentHintCacheControl | undefined;
    /** Session lifecycle control plane. */
    sessionControl: SessionControlConfig;
}
/** Messages configuration for the agent-hint route, with an optional per-request credential reference. */
export interface Config extends ProtocolConfig {
    /** Reuse host Messages providers by default; standalone owns a coordinator route. */
    mode: 'inherit' | 'standalone';
    /**
     * Credential reference resolved per request. `undefined` (the default) leaves
     * the route deliberately unauthenticated: requests carry no `authorization` header.
     */
    apiKeyEnv: Volatile<string | undefined>;
    /** Provider route id; read at plugin load (changing it requires a reload). */
    provider: string;
    /** The two `agent_hint` planes. */
    agentHint?: AgentHintConfig | undefined;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    baseURL: z<string, string, "volatile-defined">;
    models: z<NoInfer<import("@deepseek-ai/dsh-llm-deepseek").DeepSeekCatalogModel[]>, NoInfer<import("@deepseek-ai/dsh-llm-deepseek").DeepSeekCatalogModel[]>, "volatile-defined">;
    apiKeyEnv: z<string, string, "volatile">;
    provider: z<string, string, "defined">;
    agentHint: z<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        cacheControl: z<Schemastery.ObjectS<NoInfer<{
            type: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            type: z<string, string, "defined">;
        }>>, "defined">;
        sessionControl: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            pluginTriggers: z<boolean, boolean, "defined">;
            endpoint: z<string, string, "plain">;
            pendingOpAwaitMs: z<number, number, "defined">;
            controlTimeoutMs: z<number, number, "defined">;
            retries: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            pluginTriggers: z<boolean, boolean, "defined">;
            endpoint: z<string, string, "plain">;
            pendingOpAwaitMs: z<number, number, "defined">;
            controlTimeoutMs: z<number, number, "defined">;
            retries: z<number, number, "defined">;
        }>>, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        cacheControl: z<Schemastery.ObjectS<NoInfer<{
            type: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            type: z<string, string, "defined">;
        }>>, "defined">;
        sessionControl: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            pluginTriggers: z<boolean, boolean, "defined">;
            endpoint: z<string, string, "plain">;
            pendingOpAwaitMs: z<number, number, "defined">;
            controlTimeoutMs: z<number, number, "defined">;
            retries: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            pluginTriggers: z<boolean, boolean, "defined">;
            endpoint: z<string, string, "plain">;
            pendingOpAwaitMs: z<number, number, "defined">;
            controlTimeoutMs: z<number, number, "defined">;
            retries: z<number, number, "defined">;
        }>>, "plain">;
    }>>, "plain">;
    thinking: z<"enabled" | "disabled", "enabled" | "disabled", "volatile">;
    reasoningEffort: z<"low" | "off" | "high" | "max", "low" | "off" | "high" | "max", "volatile">;
    maxTokens: z<number, number, "volatile-defined">;
    defaultContextWindow: z<number, number, "volatile-defined">;
    streamIdleTimeoutMs: z<number, number, "volatile-defined">;
    maxRequestFilesBytes: z<number, number, "volatile-defined">;
    maxInlineRequestImageBytes: z<number, number, "volatile-defined">;
    maxImagesPerRequest: z<number, number, "volatile-defined">;
    imageOffloadByteQuantum: z<number, number, "volatile-defined">;
    inlineImageOffloadByteQuantum: z<number, number, "volatile-defined">;
    imageOffloadCountQuantum: z<number, number, "volatile-defined">;
    filesApiTimeoutMs: z<number, number, "volatile-defined">;
    fileExpiresAfterSeconds: z<number, number, "volatile-defined">;
    fileRefreshMarginSeconds: z<number, number, "volatile-defined">;
    fileQuotaCleanupBatch: z<number, number, "volatile-defined">;
    retryPolicy: z<NoInfer<import("@deepseek-ai/dsh-llm").RetryPolicyConfig>, NoInfer<import("@deepseek-ai/dsh-llm").RetryPolicyConfig>, "volatile">;
    mode: z<"inherit" | "standalone", "inherit" | "standalone", "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    baseURL: z<string, string, "volatile-defined">;
    models: z<NoInfer<import("@deepseek-ai/dsh-llm-deepseek").DeepSeekCatalogModel[]>, NoInfer<import("@deepseek-ai/dsh-llm-deepseek").DeepSeekCatalogModel[]>, "volatile-defined">;
    apiKeyEnv: z<string, string, "volatile">;
    provider: z<string, string, "defined">;
    agentHint: z<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        cacheControl: z<Schemastery.ObjectS<NoInfer<{
            type: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            type: z<string, string, "defined">;
        }>>, "defined">;
        sessionControl: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            pluginTriggers: z<boolean, boolean, "defined">;
            endpoint: z<string, string, "plain">;
            pendingOpAwaitMs: z<number, number, "defined">;
            controlTimeoutMs: z<number, number, "defined">;
            retries: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            pluginTriggers: z<boolean, boolean, "defined">;
            endpoint: z<string, string, "plain">;
            pendingOpAwaitMs: z<number, number, "defined">;
            controlTimeoutMs: z<number, number, "defined">;
            retries: z<number, number, "defined">;
        }>>, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        cacheControl: z<Schemastery.ObjectS<NoInfer<{
            type: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            type: z<string, string, "defined">;
        }>>, "defined">;
        sessionControl: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            pluginTriggers: z<boolean, boolean, "defined">;
            endpoint: z<string, string, "plain">;
            pendingOpAwaitMs: z<number, number, "defined">;
            controlTimeoutMs: z<number, number, "defined">;
            retries: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            pluginTriggers: z<boolean, boolean, "defined">;
            endpoint: z<string, string, "plain">;
            pendingOpAwaitMs: z<number, number, "defined">;
            controlTimeoutMs: z<number, number, "defined">;
            retries: z<number, number, "defined">;
        }>>, "plain">;
    }>>, "plain">;
    thinking: z<"enabled" | "disabled", "enabled" | "disabled", "volatile">;
    reasoningEffort: z<"low" | "off" | "high" | "max", "low" | "off" | "high" | "max", "volatile">;
    maxTokens: z<number, number, "volatile-defined">;
    defaultContextWindow: z<number, number, "volatile-defined">;
    streamIdleTimeoutMs: z<number, number, "volatile-defined">;
    maxRequestFilesBytes: z<number, number, "volatile-defined">;
    maxInlineRequestImageBytes: z<number, number, "volatile-defined">;
    maxImagesPerRequest: z<number, number, "volatile-defined">;
    imageOffloadByteQuantum: z<number, number, "volatile-defined">;
    inlineImageOffloadByteQuantum: z<number, number, "volatile-defined">;
    imageOffloadCountQuantum: z<number, number, "volatile-defined">;
    filesApiTimeoutMs: z<number, number, "volatile-defined">;
    fileExpiresAfterSeconds: z<number, number, "volatile-defined">;
    fileRefreshMarginSeconds: z<number, number, "volatile-defined">;
    fileQuotaCleanupBatch: z<number, number, "volatile-defined">;
    retryPolicy: z<NoInfer<import("@deepseek-ai/dsh-llm").RetryPolicyConfig>, NoInfer<import("@deepseek-ai/dsh-llm").RetryPolicyConfig>, "volatile">;
    mode: z<"inherit" | "standalone", "inherit" | "standalone", "defined">;
}>>, "plain">;
/** Plain deployment inputs for the agent-hint route. */
export type Options = ProtocolOptions & {
    apiKeyEnv?: string;
};
/** Endpoint and credential reference captured from the same configuration generation. */
export interface ResolvedAgentHintOptions extends DeepSeekConnectionOptions {
    /** Credential reference used only for this connection snapshot; absent sends unauthenticated requests. */
    apiKeyEnv: CredentialRef | undefined;
}
/** Read one validated provider configuration.
 * @param config - live plugin configuration.
 * @returns detached resolver inputs.
 */
export declare function plainOptions(config: Config): Options;
/** Resolve route and protocol settings together.
 * @param config - raw deployment settings.
 * @param environment - application launch environment.
 * @returns validated endpoint facts and the matching credential reference, or `undefined` when the route names none.
 */
export declare function resolveAdapterOptions(config: Options, environment?: LaunchEnvironmentSnapshot): ResolvedAgentHintOptions;
