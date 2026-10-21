import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
import { deepSeekConfigFields, plainOptions as protocolOptions, resolveAdapterOptions as resolveProtocolOptions } from '@deepseek-ai/dsh-llm-deepseek';
import { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS } from "./control-client.js";
import { DEFAULT_PENDING_OP_AWAIT_MS } from "./lifecycle-bridge.js";
/** The provider route this plugin owns; read at plugin load. */
export const DEFAULT_PROVIDER = 'deepseek-agent-hint';
/** Coordinator Messages API root; the adapter appends `/v1/messages`. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:1025';
/** Environment variable consulted when neither configuration nor a sibling route names an endpoint. */
export const BASE_URL_ENV = 'DSH_AGENT_HINT_BASE_URL';
/** No sibling route contributed anything; the identity value of {@link InheritedConnection}. */
export const NO_INHERITED_CONNECTION = {};
export const Config = z.object({
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
        cacheControl: z.object({ type: z.string().required() }).default(undefined),
        sessionControl: z.object({
            enabled: z.boolean().default(true),
            pluginTriggers: z.boolean().default(true),
            endpoint: z.string(),
            pendingOpAwaitMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_PENDING_OP_AWAIT_MS),
            controlTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_CONTROL_TIMEOUT_MS),
            retries: z.number().step(1).min(0).max(10).default(DEFAULT_CONTROL_RETRIES),
        }),
    }),
});
/** Read one validated provider configuration.
 * @param config - live plugin configuration.
 * @returns detached resolver inputs.
 */
export function plainOptions(config) {
    const apiKeyEnv = config.apiKeyEnv.get();
    return { ...protocolOptions(config), ...apiKeyEnv === undefined ? {} : { apiKeyEnv } };
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
export function resolveBaseURL(configured, inherited = NO_INHERITED_CONNECTION, environment) {
    if (configured !== DEFAULT_BASE_URL)
        return configured;
    const fromRoute = inherited.baseURL;
    if (fromRoute !== undefined && fromRoute.length > 0)
        return fromRoute;
    const fromEnvironment = environment?.get(BASE_URL_ENV)?.value;
    if (fromEnvironment !== undefined && fromEnvironment.length > 0)
        return fromEnvironment;
    return DEFAULT_BASE_URL;
}
/** Resolve the model catalog: explicit configuration, then the sibling route's.
 * @param configured - models declared on this plugin's own entry.
 * @param inherited - model catalog read from a sibling route.
 * @returns the catalog to advertise; empty when neither source declared one.
 */
export function resolveModels(configured, inherited = NO_INHERITED_CONNECTION) {
    if (configured.length > 0)
        return configured;
    const fromRoute = inherited.models;
    return fromRoute !== undefined && fromRoute.length > 0 ? [...fromRoute] : configured;
}
/** Resolve route and protocol settings together.
 * @param config - raw deployment settings.
 * @param environment - application launch environment.
 * @param inherited - endpoint facts read from a sibling route.
 * @returns validated endpoint facts and the matching credential reference, or `undefined` when the route names none.
 */
export function resolveAdapterOptions(config, environment, inherited = NO_INHERITED_CONNECTION) {
    const apiKeyEnv = config.apiKeyEnv;
    return {
        ...resolveProtocolOptions({ ...config, baseURL: resolveBaseURL(config.baseURL ?? DEFAULT_BASE_URL, inherited, environment) }, environment),
        apiKeyEnv: apiKeyEnv === undefined ? undefined : credentialRef(apiKeyEnv),
    };
}
