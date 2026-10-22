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
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Reject a cache policy that cannot be serialised verbatim.
 *
 * The coordinator dispatches on `type`, so a policy without a string `type`
 * would silently do nothing. Failing here keeps that misconfiguration visible
 * at the caller instead of producing an inert hint.
 */
export function assertValidCacheControl(value) {
    if (!isPlainObject(value)) {
        throw new AgentHintError('agent_hint cache_control must be a plain object', 'INVALID_INPUT');
    }
    const type = value['type'];
    if (typeof type !== 'string' || type.length === 0) {
        throw new AgentHintError('agent_hint cache_control.type must be a non-empty string', 'INVALID_INPUT');
    }
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
