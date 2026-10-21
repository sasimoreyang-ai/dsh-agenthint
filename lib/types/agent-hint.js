/**
 * Pure construction of the `agent_hint` wire field. One function owns every
 * inclusion rule, so the extension seam stays transport-only and every rule
 * is unit-testable without a coordinator: background-purpose calls stay
 * unprefixed, a session without identity stays anonymous, and the `start`
 * verb rides only the first ordinary request of a fresh session.
 *
 * @module dsh-llm-agent-hint/agent-hint
 */
/**
 * Build the `agent_hint` field for one request, or `undefined` when the
 * request must stay unprefixed. Rules, in order:
 *
 * 1. Defined purposes (compaction, session-title) are background calls
 *    that must not perturb the live session's KV-cache identity.
 * 2. A request without a session identity cannot prefix anything.
 * 3. An explicit piggyback verb wins over the `start` rule.
 * 4. Otherwise the first ordinary request of a fresh session declares
 *    `start`; a seeded session never re-declares it.
 * 5. `parent_session_id` and `cache_control` attach whenever their inputs
 *    are present, including on verb-carrying requests.
 *
 * @param inputs - the per-request facts collected by the extension.
 * @returns the wire object, or `undefined` to omit the field entirely.
 */
export function buildAgentHint(inputs) {
    if (inputs.purpose !== undefined)
        return undefined;
    if (inputs.sessionId === undefined)
        return undefined;
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
