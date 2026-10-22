/**
 * Register the `deepseek-agent-hint` route: a DeepSeek Messages transport aimed
 * at a MindIE-Motor coordinator, whose ordinary requests carry the `agent_hint`
 * field (session identity, optional fork lineage, optional cache policy) and
 * whose session lifecycle events plus the first ordinary request of a seeded
 * session drive `session_control` manage requests
 * (`resume`/`pause`/`compact`/`stop`) against the coordinator chat-completions
 * infer endpoint.
 *
 * The endpoint and model catalog fall back to the sibling DeepSeek route, so an
 * operator who already reaches a model configures nothing here. The transport
 * layer is the `llm-deepseek` pipeline with a route-scoped `prepareExtensions`;
 * connection facts resolve per request exactly as in `llm-deepseek`, an omitted
 * `apiKeyEnv` sends requests unauthenticated, and every control-plane failure
 * is fail-open (WARN only).
 * @module @deepseek-ai/dsh-llm-agent-hint
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { catalogModelInfo, DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { Config, plainOptions, resolveAdapterOptions, resolveModels } from './config.ts'
import type { InheritedConnection, ResolvedAgentHintOptions } from './config.ts'
import { readInheritedConnection } from './inherited-connection.ts'
import { ChatCompletionsAdapter } from './chat-adapter.ts'
import { buildAgentHint } from './agent-hint.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS, SessionControlClient } from './control-client.ts'
import { agentHintPrepareExtensions } from './extension.ts'
import { DEFAULT_PENDING_OP_AWAIT_MS, LifecycleBridge } from './lifecycle-bridge.ts'
import { observeArchives } from './archive-observer.ts'
import { AgentHintSignals } from './composing-service.ts'
import type {} from '@deepseek-ai/dsh-api-gateway'

export { buildAgentHint } from './agent-hint.ts'
export type { AgentHintInputs } from './agent-hint.ts'
export { BASE_URL_ENV, Config, DEFAULT_BASE_URL, DEFAULT_PROVIDER, NO_INHERITED_CONNECTION, plainOptions, resolveAdapterOptions, resolveBaseURL, resolveModels } from './config.ts'
export type { AgentHintConfig, InheritedConnection, Options, ResolvedAgentHintOptions, SessionControlConfig } from './config.ts'
export { INHERIT_SOURCE_ID, readInheritedConnection } from './inherited-connection.ts'
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
  // Endpoint and catalog fall back to the sibling route an operator already
  // configured, so a deployment that reaches a model needs no value here. The
  // read is cached because `options()` runs once per request, and is only
  // pinned once the editor is mounted: an early read must not freeze an empty
  // answer for the rest of the process.
  let inheritedSource: InheritedConnection | undefined
  const inherited = (): InheritedConnection => {
    if (inheritedSource !== undefined) return inheritedSource
    const read = readInheritedConnection(ctx)
    if (ctx.get('configEditor') !== undefined) inheritedSource = read
    return read
  }
  const options = () => {
    const base = plainOptions(config)
    const source = inherited()
    return resolveAdapterOptions(
      { ...base, models: resolveModels(base.models ?? [], source) },
      launchEnvironmentOf(ctx),
      source,
    )
  }
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
        resolveConnection: async () => {
          const connection = options()
          return {
            endpoint: sessionControl?.endpoint ?? `${connection.baseURL.replace(/\/+$/, '')}/v1/chat/completions`,
            apiKey: await resolveApiKey(connection),
          }
        },
        model: options().models[0]?.id ?? 'default',
        timeoutMs: sessionControl?.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS,
        retries: sessionControl?.retries ?? DEFAULT_CONTROL_RETRIES,
        warn: (message, error) => {
          ctx.logger.warn(message)
          if (error !== undefined) ctx.logger.warn(error)
        },
      }),
      pendingOpAwaitMs: sessionControl?.pendingOpAwaitMs ?? DEFAULT_PENDING_OP_AWAIT_MS,
      warn: message => ctx.logger.warn(message),
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
    { provider, displayName: 'DeepSeek (agent-hint)', settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: [], declared: true },
  ])
  const chained = (request: Parameters<ReturnType<typeof agentHintPrepareExtensions>>[0]) =>
    ctx.get('deepseekLlmApiExtensions')?.prepare(request)
      ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
  const discoverModels = (route: string) =>
    Promise.resolve(options().models.map(model => catalogModelInfo(route, model)))
  const resolveAuth = async (connection: ResolvedAgentHintOptions) => {
    const key = await resolveApiKey(connection)
    const headers: Record<string, string> = {}
    if (key !== undefined) headers.authorization = `Bearer ${key}`
    return { headers }
  }

  // The hint seam is protocol-independent: the Messages transport reaches it
  // through `prepareExtensions`, the chat transport through `prepareHint`.
  // Both share the same barrier, state facts and accept transaction.
  const hintFor = async (
    sessionId: string | undefined,
    purpose: 'compaction' | 'session-title' | undefined,
    model: string,
  ) => {
    if (!hintEnabled) return undefined
    const id = sessionId === undefined ? undefined : SessionId(sessionId)
    if (bridge !== undefined && purpose === undefined) {
      bridge.ensureResume(id, model)
      await bridge.awaitPendingOp(id)
    }
    const facts = bridge?.facts(id) ?? { seeded: false, firstOrdinarySent: true, parentSessionId: undefined }
    return buildAgentHint({
      sessionId,
      purpose,
      parentSessionId: facts.parentSessionId === undefined ? undefined : String(facts.parentSessionId),
      cacheControl,
      seeded: facts.seeded,
      firstOrdinarySent: facts.firstOrdinarySent,
    })
  }

  // rc.1 registerDeepSeekProvider replaces prepareExtensions after spreading
  // its arguments. The public Adapter API preserves this route's callback.
  const adapter = config.transport === 'chat'
    ? new ChatCompletionsAdapter({
      options,
      providerName: 'DeepSeek (agent-hint)',
      discoverModels,
      resolveAuth: () => resolveAuth(options()),
      prepareHint: request => hintFor(request.sessionId, request.purpose, options().models[0]?.id ?? request.sessionId ?? 'default'),
      ...hintEnabled ? {
        onAccepted: (request: { sessionId: string | undefined }) => {
          if (bridge === undefined) return
          const id = request.sessionId === undefined ? undefined : SessionId(request.sessionId)
          bridge.noteOrdinaryRequest(id, options().models[0]?.id ?? 'default')
        },
      } : {},
    })
    : new DeepSeekAdapter({
      options,
      providerName: 'DeepSeek (agent-hint)',
      resolveUserId: getOrCreateAnonymousUserId,
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments,
        hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
      resolveAuth,
      discoverModels,
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
    // A sibling route may have just been reconfigured; re-read before deciding.
    inheritedSource = undefined
    const current = JSON.stringify(options().retryPolicy)
    if (current !== retryPolicy) { registration.replace([provider]); retryPolicy = current }
  })
}
