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
/** Resolve route and protocol settings together.
 * @param config - raw deployment settings.
 * @param environment - application launch environment.
 * @returns validated endpoint facts and the matching credential reference, or `undefined` when the route names none.
 */
export function resolveAdapterOptions(config, environment) {
    const apiKeyEnv = config.apiKeyEnv;
    return {
        ...resolveProtocolOptions(config, environment),
        apiKeyEnv: apiKeyEnv === undefined ? undefined : credentialRef(apiKeyEnv),
    };
}
