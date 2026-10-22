/**
 * Pure construction of the `agent_hint` wire field.
 *
 * One function owns every inclusion rule, so the host's request seam stays
 * transport-only and every rule is testable without a coordinator or a model:
 * background calls stay unprefixed, a request without session identity stays
 * anonymous, and the `start` verb rides only the first ordinary request of a
 * fresh session.
 *
 * @module agenthint-core/hint
 */
import { AgentHintError } from "./errors.js";
function isPlainObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    // Reject class instances (Date, Map, …): they do not survive JSON encoding.
    return proto === Object.prototype || proto === null;
}
/**
 * Assert that a value survives `JSON.stringify` without loss.
 *
 * Passing this check must mean the value encodes exactly as written: `NaN` and
 * `Infinity` would become `null`, functions and `undefined` would disappear,
 * `BigInt` would throw, and cycles would throw. Config that arrives from a user
 * or a platform is dynamic input, so the TypeScript types are not enough.
 */
export function assertJsonValue(value, path = 'value', seen = new Set()) {
    if (value === null)
        return;
    switch (typeof value) {
        case 'string':
        case 'boolean':
            return;
        case 'number':
            if (!Number.isFinite(value)) {
                throw new AgentHintError(`${path} must be a finite number`, 'INVALID_INPUT');
            }
            return;
        case 'object': {
            if (seen.has(value)) {
                throw new AgentHintError(`${path} contains a circular reference`, 'INVALID_INPUT');
            }
            seen.add(value);
            if (Array.isArray(value)) {
                value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
            }
            else if (isPlainObject(value)) {
                for (const [key, item] of Object.entries(value)) {
                    assertJsonValue(item, `${path}.${key}`, seen);
                }
            }
            else {
                throw new AgentHintError(`${path} must be a plain object or array`, 'INVALID_INPUT');
            }
            seen.delete(value);
            return;
        }
        default:
            // undefined, function, symbol, bigint
            throw new AgentHintError(`${path} must be JSON-serialisable (got ${typeof value})`, 'INVALID_INPUT');
    }
}
/**
 * Reject a cache policy that cannot be serialised verbatim.
 *
 * The coordinator dispatches on `type`, so a policy without a string `type`
 * would silently do nothing, and any value that JSON would drop or reject would
 * change the hint after it was validated.
 */
export function assertValidCacheControl(value) {
    if (!isPlainObject(value)) {
        throw new AgentHintError('agent_hint cache_control must be a plain object', 'INVALID_INPUT');
    }
    const type = value['type'];
    if (typeof type !== 'string' || type.length === 0) {
        throw new AgentHintError('agent_hint cache_control.type must be a non-empty string', 'INVALID_INPUT');
    }
    assertJsonValue(value, 'agent_hint cache_control');
}
/**
 * Build the `agent_hint` field for one request, or `undefined` when the
 * request must stay unprefixed. Rules, in order:
 *
 * 1. Background calls must not perturb the live session's KV-cache identity.
 * 2. A request without a session identity cannot prefix anything.
 * 3. An explicit piggyback verb wins over the `start` rule.
 * 4. Otherwise the first ordinary request of a fresh session declares
 *    `start`; a seeded session never re-declares it.
 * 5. `parent_session_id` and `cache_control` attach whenever their inputs
 *    are present, including on verb-carrying requests.
 *
 * @param inputs - the per-request facts collected by the host adapter.
 * @returns the wire object, or `undefined` to omit the field entirely.
 * @throws AgentHintError with code `INVALID_INPUT` when a supplied cache
 *   policy cannot be serialised verbatim.
 */
export function buildAgentHint(inputs) {
    if (inputs.requestClass === 'background')
        return undefined;
    if (inputs.sessionId === undefined)
        return undefined;
    // Runtime callers are not necessarily TypeScript: a non-string identity would
    // travel to the backend as a JSON number and key the cache incorrectly.
    if (typeof inputs.sessionId !== 'string' || inputs.sessionId.length === 0) {
        throw new AgentHintError('sessionId must be a non-empty string when present', 'INVALID_INPUT');
    }
    if (inputs.parentSessionId !== undefined
        && (typeof inputs.parentSessionId !== 'string' || inputs.parentSessionId.length === 0)) {
        throw new AgentHintError('parentSessionId must be a non-empty string when present', 'INVALID_INPUT');
    }
    if (inputs.cacheControl !== undefined)
        assertValidCacheControl(inputs.cacheControl);
    const hint = { session_id: inputs.sessionId };
    if (inputs.parentSessionId !== undefined) {
        hint.parent_session_id = inputs.parentSessionId;
    }
    if (inputs.cacheControl !== undefined) {
        hint.cache_control = { ...inputs.cacheControl };
    }
    if (inputs.sessionControl !== undefined) {
        hint.session_control = { type: inputs.sessionControl };
    }
    else if (!inputs.seeded && !inputs.firstOrdinarySent) {
        hint.session_control = { type: 'start' };
    }
    return hint;
}
