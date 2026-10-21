/**
 * By default, extend existing host Messages requests through the public
 * extension registry, without registering or configuring a model provider.
 * In explicit standalone mode, register the `deepseek-agent-hint` route: a DeepSeek
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
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { catalogModelInfo, DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek';
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
import { plainOptions, resolveAdapterOptions, resolveModels } from "./config.js";
import { readInheritedConnection } from "./inherited-connection.js";
import { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS, SessionControlClient } from "./control-client.js";
import { agentHintPrepareExtensions } from "./extension.js";
import { DEFAULT_PENDING_OP_AWAIT_MS, LifecycleBridge } from "./lifecycle-bridge.js";
import { observeArchives } from "./archive-observer.js";
import { AgentHintSignals } from "./composing-service.js";
import { installInheritedHints } from "./inherit.js";
export { buildAgentHint } from "./agent-hint.js";
export { BASE_URL_ENV, Config, DEFAULT_BASE_URL, DEFAULT_PROVIDER, NO_INHERITED_CONNECTION, plainOptions, resolveAdapterOptions, resolveBaseURL, resolveModels } from "./config.js";
export { INHERIT_SOURCE_ID, readInheritedConnection } from "./inherited-connection.js";
export { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS, SessionControlClient } from "./control-client.js";
export { agentHintPrepareExtensions } from "./extension.js";
export { DEFAULT_PENDING_OP_AWAIT_MS, LifecycleBridge } from "./lifecycle-bridge.js";
export const name = 'llm-agent-hint';
export const inject = ['llm'];
export function apply(ctx, config) {
    if (config.mode === 'inherit') {
        if (config.agentHint?.enabled !== false)
            installInheritedHints(ctx, config.agentHint?.cacheControl ?? undefined);
        return;
    }
    const provider = config.provider;
    // Endpoint and catalog fall back to the sibling route an operator already
    // configured, so a deployment that reaches a model needs no value here. The
    // read is cached because `options()` runs once per request, and is only
    // pinned once the editor is mounted: an early read must not freeze an empty
    // answer for the rest of the process.
    let inheritedSource;
    const inherited = () => {
        if (inheritedSource !== undefined)
            return inheritedSource;
        const read = readInheritedConnection(ctx);
        if (ctx.get('configEditor') !== undefined)
            inheritedSource = read;
        return read;
    };
    const options = () => {
        const base = plainOptions(config);
        const source = inherited();
        return resolveAdapterOptions({ ...base, models: resolveModels(base.models ?? [], source) }, launchEnvironmentOf(ctx), source);
    };
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
        throw new LlmError(`llm-agent-hint: no API key for provider route "${provider}"; store ${ref} through the credentials`
            + ` service (the web Models page writes it), or export ${ref} in the launching environment`, 'MISSING_CREDENTIAL');
    };
    const hintEnabled = config.agentHint?.enabled !== false;
    const sessionControl = config.agentHint?.sessionControl;
    const controlEnabled = hintEnabled && sessionControl?.enabled !== false;
    const bridge = controlEnabled
        ? new LifecycleBridge({
            client: new SessionControlClient({
                endpoint: sessionControl?.endpoint ?? `${options().baseURL.replace(/\/+$/, '')}/v1/chat/completions`,
                resolveApiKey: async () => resolveApiKey(options()),
                resolveConnection: async () => {
                    const connection = options();
                    return {
                        endpoint: sessionControl?.endpoint ?? `${connection.baseURL.replace(/\/+$/, '')}/v1/chat/completions`,
                        apiKey: await resolveApiKey(connection),
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
    const adapter = new DeepSeekAdapter({
        options,
        providerName: 'DeepSeek (agent-hint)',
        resolveUserId: getOrCreateAnonymousUserId,
        resolveAttachments: () => ctx.get('attachments'),
        resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
        resolveAuth: async (connection) => {
            const key = await resolveApiKey(connection);
            const headers = {};
            if (key !== undefined)
                headers.authorization = `Bearer ${key}`;
            return { headers };
        },
        discoverModels: route => Promise.resolve(options().models.map(model => catalogModelInfo(route, model))),
        prepareExtensions: hintEnabled
            ? agentHintPrepareExtensions({
                chained,
                ...bridge === undefined ? {} : { bridge },
                ...cacheControl === undefined ? {} : { cacheControl },
            })
            : chained,
    });
    const registration = ctx.llm.registerAdapter([provider], adapter);
    let retryPolicy = JSON.stringify(options().retryPolicy);
    ctx.on('loader/volatile-update', () => {
        // A sibling route may have just been reconfigured; re-read before deciding.
        inheritedSource = undefined;
        const current = JSON.stringify(options().retryPolicy);
        if (current !== retryPolicy) {
            registration.replace([provider]);
            retryPolicy = current;
        }
    });
}
