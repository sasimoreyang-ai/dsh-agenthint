/** Plugin configuration and request-local resolution for the agent-hint route. */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { deepSeekConfigFields, plainOptions as protocolOptions, resolveAdapterOptions as resolveProtocolOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { Config as ProtocolConfig, DeepSeekCatalogModel, DeepSeekConnectionOptions, Options as ProtocolOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS } from './control-client.ts'
import { DEFAULT_PENDING_OP_AWAIT_MS } from './lifecycle-bridge.ts'
import type { AgentHintCacheControl } from './types.ts'

/** The provider route this plugin owns; read at plugin load. */
export const DEFAULT_PROVIDER = 'deepseek-agent-hint'
/** Coordinator Messages API root; the adapter appends `/v1/messages`. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:1025'
/** Environment variable consulted when neither configuration nor a sibling route names an endpoint. */
export const BASE_URL_ENV = 'DSH_AGENT_HINT_BASE_URL'

/**
 * Connection facts a sibling DeepSeek route already resolved. An operator who
 * can already talk to a model has, by construction, already named the endpoint
 * this plugin needs; asking them to type it again is the entire configuration
 * burden this shape removes.
 */
export interface InheritedConnection {
  /** Endpoint of the sibling route, when it configured one. */
  baseURL?: string | undefined
  /** Model catalog of the sibling route, when it declared one. */
  models?: readonly DeepSeekCatalogModel[] | undefined
}

/** No sibling route contributed anything; the identity value of {@link InheritedConnection}. */
export const NO_INHERITED_CONNECTION: InheritedConnection = {}

/** Session lifecycle control plane configuration. */
export interface SessionControlConfig {
  /** `false` disables manage requests; the static data plane keeps working. */
  enabled: boolean
  /** Install stock-host composer Remote and public archive observers. Default: true. */
  pluginTriggers?: boolean
  /** Full manage-request URL; omission derives `<baseURL>/v1/chat/completions`. */
  endpoint?: string | undefined
  /** Cap on how long an ordinary request waits for an in-flight verb. */
  pendingOpAwaitMs: number
  /** Per-attempt control-request timeout in milliseconds. */
  controlTimeoutMs: number
  /** Transport-level retries after the first failed attempt. */
  retries: number
}

/** The two `agent_hint` planes: static hint injection and lifecycle control. */
export interface AgentHintConfig {
  /** Master switch for `agent_hint` injection; `false` degrades to plain Messages transport. */
  enabled: boolean
  /** Static coordinator cache policy copied verbatim into every hint. */
  cacheControl?: AgentHintCacheControl | undefined
  /** Session lifecycle control plane. */
  sessionControl: SessionControlConfig
}

/** Messages configuration for the agent-hint route, with an optional per-request credential reference. */
export interface Config extends ProtocolConfig {
  /** Reuse host Messages providers by default; standalone owns a coordinator route. */
  mode: 'inherit' | 'standalone'
  /**
   * Credential reference resolved per request. `undefined` (the default) leaves
   * the route deliberately unauthenticated: requests carry no `authorization` header.
   */
  apiKeyEnv: Volatile<string | undefined>
  /** Provider route id; read at plugin load (changing it requires a reload). */
  provider: string
  /** The two `agent_hint` planes. */
  agentHint?: AgentHintConfig | undefined
}

export const Config = z.object({
  mode: z.union(['inherit', 'standalone']).default('inherit'),
  ...deepSeekConfigFields,
  baseURL: z.string().default(DEFAULT_BASE_URL).volatile(),
  models: deepSeekConfigFields.models.default([]),
  apiKeyEnv: z.string().role('credential-ref').volatile(),
  provider: z.string().default(DEFAULT_PROVIDER),
  agentHint: z.object({
    enabled: z.boolean().default(true),
    // `z.object` implicitly defaults to `{}`, which would cascade a missing
    // `cacheControl` into existence and trip the inner required `type`. The
    // explicit `default(undefined)` keeps the whole block optional: absent
    // stays absent (no `cache_control` in any hint); a provided block must
    // still name its `type`.
    cacheControl: z.object({ type: z.string().required() }).default(undefined as never),
    sessionControl: z.object({
      enabled: z.boolean().default(true),
      pluginTriggers: z.boolean().default(true),
      endpoint: z.string(),
      pendingOpAwaitMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_PENDING_OP_AWAIT_MS),
      controlTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_CONTROL_TIMEOUT_MS),
      retries: z.number().step(1).min(0).max(10).default(DEFAULT_CONTROL_RETRIES),
    }),
  }),
})

/** Plain deployment inputs for the agent-hint route. */
export type Options = ProtocolOptions & { apiKeyEnv?: string }

/** Endpoint and credential reference captured from the same configuration generation. */
export interface ResolvedAgentHintOptions extends DeepSeekConnectionOptions {
  /** Credential reference used only for this connection snapshot; absent sends unauthenticated requests. */
  apiKeyEnv: CredentialRef | undefined
}

/** Read one validated provider configuration.
 * @param config - live plugin configuration.
 * @returns detached resolver inputs.
 */
export function plainOptions(config: Config): Options {
  const apiKeyEnv = config.apiKeyEnv.get()
  return { ...protocolOptions(config), ...apiKeyEnv === undefined ? {} : { apiKeyEnv } }
}

/** Resolve the coordinator endpoint through a fixed precedence chain.
 *
 * An explicit operator value always wins. The built-in loopback default is the
 * last resort, so it must never mask an inherited route or the environment: the
 * whole point of the chain is that a deployment which already reaches a model
 * needs to configure nothing here.
 *
 * @param configured - the resolved plugin configuration value.
 * @param inherited - endpoint facts read from a sibling route.
 * @param environment - application launch environment.
 * @returns the endpoint every request for this route should use.
 */
export function resolveBaseURL(
  configured: string,
  inherited: InheritedConnection = NO_INHERITED_CONNECTION,
  environment?: LaunchEnvironmentSnapshot,
): string {
  if (configured !== DEFAULT_BASE_URL) return configured
  const fromRoute = inherited.baseURL
  if (fromRoute !== undefined && fromRoute.length > 0) return fromRoute
  const fromEnvironment = environment?.get(BASE_URL_ENV)?.value
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) return fromEnvironment
  return DEFAULT_BASE_URL
}

/** Resolve the model catalog: explicit configuration, then the sibling route's.
 * @param configured - models declared on this plugin's own entry.
 * @param inherited - model catalog read from a sibling route.
 * @returns the catalog to advertise; empty when neither source declared one.
 */
export function resolveModels(
  configured: DeepSeekCatalogModel[],
  inherited: InheritedConnection = NO_INHERITED_CONNECTION,
): DeepSeekCatalogModel[] {
  if (configured.length > 0) return configured
  const fromRoute = inherited.models
  return fromRoute !== undefined && fromRoute.length > 0 ? [...fromRoute] : configured
}

/** Resolve route and protocol settings together.
 * @param config - raw deployment settings.
 * @param environment - application launch environment.
 * @param inherited - endpoint facts read from a sibling route.
 * @returns validated endpoint facts and the matching credential reference, or `undefined` when the route names none.
 */
export function resolveAdapterOptions(
  config: Options,
  environment?: LaunchEnvironmentSnapshot,
  inherited: InheritedConnection = NO_INHERITED_CONNECTION,
): ResolvedAgentHintOptions {
  const apiKeyEnv = config.apiKeyEnv
  return {
    ...resolveProtocolOptions({ ...config, baseURL: resolveBaseURL(config.baseURL ?? DEFAULT_BASE_URL, inherited, environment) }, environment),
    apiKeyEnv: apiKeyEnv === undefined ? undefined : credentialRef(apiKeyEnv),
  }
}
