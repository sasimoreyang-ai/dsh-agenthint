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
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { catalogModelInfo } from '@deepseek-ai/dsh-llm-deepseek';
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
import { plainOptions, resolveAdapterOptions } from "./config.js";
import { AgentHintAdapter } from "./adapter.js";
import { ChatCompletionsAdapter, chatCompletionsURL } from "./chat-adapter.js";
import { buildAgentHint } from "./agent-hint.js";
import { SessionId } from '@deepseek-ai/dsh-session';
import { readInheritedConnection } from "./inherited-connection.js";
import { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS, SessionControlClient } from "./control-client.js";
import { agentHintPrepareExtensions } from "./extension.js";
import { DEFAULT_PENDING_OP_AWAIT_MS, LifecycleBridge } from "./lifecycle-bridge.js";
import { observeArchives } from "./archive-observer.js";
import { AgentHintSignals } from "./composing-service.js";
export { buildAgentHint } from "./agent-hint.js";
export { BASE_URL_ENV, Config, DEFAULT_BASE_URL, DEFAULT_PROVIDER, NO_INHERITED_CONNECTION, plainOptions, resolveAdapterOptions, resolveBaseURL, resolveModels } from "./config.js";
export { INHERIT_SOURCE_ID, readInheritedConnection } from "./inherited-connection.js";
export { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS, SessionControlClient } from "./control-client.js";
export { agentHintPrepareExtensions } from "./extension.js";
export { ControlBarrierError, DEFAULT_PENDING_OP_AWAIT_MS, LifecycleBridge } from "./lifecycle-bridge.js";
export const name = 'llm-agent-hint';
export const inject = ['llm'];
export function apply(ctx, config) {
    const lifetime = new AbortController();
    ctx.effect(() => () => lifetime.abort(), 'agent-hint: adapter lifetime');
    const provider = config.provider;
    const options = () => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx), readInheritedConnection(ctx));
    options();
    const resolveApiKey = async (connection) => {
        const ref = connection.apiKeyEnv;
        if (ref === undefined)
            return undefined;
        const credentials = ctx.get('credentials');
        if (credentials !== undefined) {
            const hit = await credentials.resolve(ref);
            if (hit !== undefined)
                return assertUsableApiKey(hit.value, 'llm-agent-hint', ref);
        }
        else {
            const ambient = launchEnvironmentOf(ctx).get(ref);
            if (ambient !== undefined && ambient.value.length > 0)
                return assertUsableApiKey(ambient.value, 'llm-agent-hint', ref);
        }
        // An unauthenticated local coordinator may coexist with the stock route's
        // default, unused DEEPSEEK_API_KEY reference. Explicit plugin refs are strict.
        if (connection.credentialInherited)
            return undefined;
        throw new LlmError(`llm-agent-hint: no API key for provider route "${provider}"; store ${ref} through the credentials`
            + ` service (the web Models page writes it), or export ${ref} in the launching environment`, 'MISSING_CREDENTIAL');
    };
    const hintEnabled = config.agentHint?.enabled !== false;
    const sessionControl = config.agentHint?.sessionControl;
    const controlEnabled = hintEnabled && sessionControl?.enabled !== false;
    const bridge = controlEnabled
        ? new LifecycleBridge({
            client: new SessionControlClient({
                endpoint: sessionControl?.endpoint ?? chatCompletionsURL(options().baseURL),
                resolveApiKey: async () => resolveApiKey(options()),
                resolveConnection: async () => {
                    const connection = options();
                    const endpoint = sessionControl?.endpoint ?? chatCompletionsURL(connection.baseURL);
                    if (connection.apiKeyEnv !== undefined && new URL(endpoint).origin !== new URL(connection.baseURL).origin) {
                        throw new Error('llm-agent-hint: refusing to forward model credentials to a different control origin');
                    }
                    return {
                        endpoint,
                        apiKey: await resolveApiKey(connection),
                        authHeader: connection.authHeader,
                    };
                },
                model: options().models[0]?.id ?? 'default',
                timeoutMs: sessionControl?.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS,
                retries: sessionControl?.retries ?? DEFAULT_CONTROL_RETRIES,
                warn: (message, error) => {
                    ctx.logger.warn(message);
                    if (error !== undefined)
                        ctx.logger.warn(error);
                },
            }),
            pendingOpAwaitMs: sessionControl?.pendingOpAwaitMs ?? DEFAULT_PENDING_OP_AWAIT_MS,
            warn: message => ctx.logger.warn(message),
        })
        : undefined;
    bridge?.subscribe(ctx);
    if (bridge !== undefined && sessionControl?.pluginTriggers !== false) {
        ctx.inject(['typertGateway'], (scope) => { scope.plugin(AgentHintSignals, bridge); });
        ctx.inject(['workspaceRegistry'], (scope) => {
            try {
                scope.effect(() => observeArchives(scope.workspaceRegistry, id => bridge.onSessionArchived(id), id => bridge.onSessionUnarchived(id)), 'agent-hint: observe public archive methods');
            }
            catch (error) {
                ctx.logger.warn('agent-hint: archive observer unavailable; disposal stop remains active', error);
            }
        });
    }
    // `null` survives schema resolution (the optional-object default only
    // covers the absent case); treat it as absent too so no empty
    // `cache_control` block ever reaches a hint.
    const cacheControl = config.agentHint?.cacheControl ?? undefined;
    ctx.llm.registerConfigurableProviders([
        { provider, displayName: 'DeepSeek (agent-hint)', settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: [], declared: true },
    ]);
    const chained = (request) => ctx.get('deepseekLlmApiExtensions')?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() });
    // rc.1 registerDeepSeekProvider replaces prepareExtensions after spreading
    // its arguments. The public Adapter API preserves this route's callback.
    const authForConnection = async (connection) => {
        const key = await resolveApiKey(connection);
        const headers = {};
        if (key !== undefined)
            headers[connection.authHeader] = connection.authHeader === 'authorization' ? `Bearer ${key}` : key;
        return { headers };
    };
    const adapter = config.transport === 'chat' ? new ChatCompletionsAdapter({
        options,
        providerName: 'DeepSeek (agent-hint)',
        resolveAuth: authForConnection,
        bridge,
        signal: lifetime.signal,
        prepareHint: request => {
            if (!hintEnabled)
                return undefined;
            const id = request.sessionId === undefined ? undefined : SessionId(request.sessionId);
            const facts = bridge?.facts(id) ?? { seeded: false, firstOrdinarySent: true, parentSessionId: undefined };
            return buildAgentHint({ sessionId: request.sessionId, purpose: request.purpose,
                parentSessionId: facts.parentSessionId, cacheControl,
                seeded: facts.seeded, firstOrdinarySent: facts.firstOrdinarySent });
        },
        onAccepted: request => {
            if (hintEnabled && request.purpose === undefined)
                bridge?.noteOrdinaryRequest(request.sessionId === undefined ? undefined : SessionId(request.sessionId), request.model);
        },
    }) : new AgentHintAdapter({
        options,
        providerName: 'DeepSeek (agent-hint)',
        resolveUserId: getOrCreateAnonymousUserId,
        resolveAttachments: () => ctx.get('attachments'),
        resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
        resolveAuth: authForConnection,
        discoverModels: route => Promise.resolve(options().models.map(model => catalogModelInfo(route, model))),
        prepareExtensions: hintEnabled
            ? agentHintPrepareExtensions({
                chained,
                streamLease: true,
                ...bridge === undefined ? {} : { bridge },
                ...cacheControl === undefined ? {} : { cacheControl },
            })
            : chained,
    }, bridge, lifetime.signal);
    const registration = ctx.llm.registerAdapter([provider], adapter);
    let signature = '';
    const refresh = () => {
        const current = options();
        const next = JSON.stringify(current);
        if (next === signature)
            return;
        signature = next;
        registration.replace([provider]);
        ctx.logger.info(`agent-hint: provider=${provider} origin=${new URL(current.baseURL).origin} models=${current.models.length} credential=${current.apiKeyEnv === undefined ? 'none' : current.credentialInherited ? 'inherited-reference' : 'explicit-reference'}`);
        if (current.models.length === 0)
            ctx.logger.warn('agent-hint: no selectable models; configure the source llm-deepseek route or explicit plugin models');
    };
    // Source changes are scoped to a sibling fiber; topology changes include reload/remove.
    ctx.on('loader/volatile-update', refresh, { global: true });
    ctx.on('loader/config-update', refresh, { global: true });
    ctx.on('loader/entry-init', refresh, { global: true });
    // Entry creation precedes activation. Refresh after a source reaches/leaves
    // active state too, including disable, removal and re-addition.
    let disposed = false;
    let refreshQueued = false;
    ctx.effect(() => () => { disposed = true; }, 'agent-hint: catalog refresh');
    ctx.on('internal/status', fiber => {
        if (fiber.entry?.options.id !== 'llm-deepseek' || refreshQueued)
            return;
        refreshQueued = true;
        queueMicrotask(() => {
            refreshQueued = false;
            if (!disposed) {
                try {
                    refresh();
                }
                catch (error) {
                    ctx.logger.warn('agent-hint: source refresh failed', error);
                }
            }
        });
    }, { global: true });
    refresh();
}
