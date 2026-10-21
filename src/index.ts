/**
 * Register the `deepseek-agent-hint` provider route on `ctx.llm`: a DeepSeek
 * Messages transport aimed at a MindIE-Motor coordinator, whose ordinary
 * requests carry the `agent_hint` field (session identity, optional fork
 * lineage, optional cache policy) and whose session lifecycle events plus the
 * first ordinary request of a seeded session drive standalone
 * `session_control` manage requests (`resume`/`pause`/`compact`/`stop`)
 * against the coordinator's chat-completions infer endpoint.
 * The transport layer is the `llm-deepseek` pipeline with a route-scoped
 * `prepareExtensions`; connection facts resolve per request exactly as in
 * `llm-deepseek`, an omitted `apiKeyEnv` sends requests unauthenticated, and
 * every control-plane failure is fail-open (WARN only).
 * @module @deepseek-ai/dsh-llm-agent-hint
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { catalogModelInfo, DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { Config, plainOptions, resolveAdapterOptions } from './config.ts'
import type { ResolvedAgentHintOptions } from './config.ts'
import { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS, SessionControlClient } from './control-client.ts'
import { agentHintPrepareExtensions } from './extension.ts'
import { DEFAULT_PENDING_OP_AWAIT_MS, LifecycleBridge } from './lifecycle-bridge.ts'
import { observeArchives } from './archive-observer.ts'
import { AgentHintSignals } from './composing-service.ts'
import type {} from '@deepseek-ai/dsh-api-gateway'

export { buildAgentHint } from './agent-hint.ts'
export type { AgentHintInputs } from './agent-hint.ts'
export { Config, DEFAULT_BASE_URL, DEFAULT_PROVIDER, plainOptions, resolveAdapterOptions } from './config.ts'
export type { AgentHintConfig, Options, ResolvedAgentHintOptions, SessionControlConfig } from './config.ts'
export { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS, SessionControlClient } from './control-client.ts'
export type { ControlWarnSink, SessionControlClientOptions } from './control-client.ts'
export { agentHintPrepareExtensions } from './extension.ts'
export type { AgentHintExtensionOptions } from './extension.ts'
export { DEFAULT_PENDING_OP_AWAIT_MS, LifecycleBridge } from './lifecycle-bridge.ts'
export type { BridgeWarnSink, LifecycleBridgeOptions } from './lifecycle-bridge.ts'
export type { AgentHintCacheControl, AgentHintWire, SessionControlVerb } from './types.ts'

export const name = 'llm-agent-hint'
export const inject = ['llm']

export function apply(ctx: Context, config: Config): void {
  const provider = config.provider
  const options = () => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))
  options()
  const resolveApiKey = async (connection: ResolvedAgentHintOptions): Promise<string | undefined> => {
    const ref = connection.apiKeyEnv
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-agent-hint', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) return assertUsableApiKey(ambient.value, 'llm-agent-hint', ref)
    }
    throw new LlmError(
      `llm-agent-hint: no API key for provider route "${provider}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  const hintEnabled = config.agentHint?.enabled !== false
  const sessionControl = config.agentHint?.sessionControl
  const controlEnabled = hintEnabled && sessionControl?.enabled !== false
  const bridge = controlEnabled
    ? new LifecycleBridge({
      client: new SessionControlClient({
        endpoint: sessionControl?.endpoint ?? `${options().baseURL.replace(/\/+$/, '')}/v1/chat/completions`,
        resolveApiKey: async () => resolveApiKey(options()),
        model: options().models[0]?.id ?? 'default',
        timeoutMs: sessionControl?.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS,
        retries: sessionControl?.retries ?? DEFAULT_CONTROL_RETRIES,
        warn: (message, error) => {
          ctx.logger.warn(message)
          if (error !== undefined) ctx.logger.warn(error)
        },
      }),
      pendingOpAwaitMs: sessionControl?.pendingOpAwaitMs ?? DEFAULT_PENDING_OP_AWAIT_MS,
    })
    : undefined
  bridge?.subscribe(ctx)
  if (bridge !== undefined && sessionControl?.pluginTriggers !== false) {
    ctx.inject(['typertGateway'], (scope) => { scope.plugin(AgentHintSignals, bridge) })
    ctx.inject(['workspaceRegistry'], (scope) => {
      try {
        scope.effect(() => observeArchives(scope.workspaceRegistry,
          id => bridge.onSessionArchived(id), id => bridge.onSessionUnarchived(id)),
        'agent-hint: observe public archive methods')
      } catch (error) {
        ctx.logger.warn('agent-hint: archive observer unavailable; disposal stop remains active', error)
      }
    })
  }

  // `null` survives schema resolution (the optional-object default only
  // covers the absent case); treat it as absent too so no empty
  // `cache_control` block ever reaches a hint.
  const cacheControl = config.agentHint?.cacheControl ?? undefined

  ctx.llm.registerConfigurableProviders([
    { provider, displayName: 'DeepSeek (agent-hint)', settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: [] },
  ])
  const chained = (request: Parameters<ReturnType<typeof agentHintPrepareExtensions>>[0]) =>
    ctx.get('deepseekLlmApiExtensions')?.prepare(request)
      ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
  // rc.1 registerDeepSeekProvider replaces prepareExtensions after spreading
  // its arguments. The public Adapter API preserves this route's callback.
  const adapter = new DeepSeekAdapter({
    options,
    providerName: 'DeepSeek (agent-hint)',
    resolveUserId: getOrCreateAnonymousUserId,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
    resolveAuth: async (connection) => {
      const key = await resolveApiKey(connection)
      const headers: Record<string, string> = {}
      if (key !== undefined) headers.authorization = `Bearer ${key}`
      return { headers }
    },
    discoverModels: route => Promise.resolve(options().models.map(model => catalogModelInfo(route, model))),
    prepareExtensions: hintEnabled
      ? agentHintPrepareExtensions({
          chained,
          ...bridge === undefined ? {} : { bridge },
          ...cacheControl === undefined ? {} : { cacheControl },
        })
      : chained,
  })
  const registration = ctx.llm.registerAdapter([provider], adapter)
  let retryPolicy = JSON.stringify(options().retryPolicy)
  ctx.on('loader/volatile-update', () => {
    const current = JSON.stringify(options().retryPolicy)
    if (current !== retryPolicy) { registration.replace([provider]); retryPolicy = current }
  })
}
