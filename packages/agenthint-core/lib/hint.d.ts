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
import type { AgentHintCacheControl, AgentHintWire, ControlVerb, RequestClass } from './types.ts';
/** Facts the host collects per request; no wire knowledge leaks back out. */
export interface HintInputs {
    /** Session identity of the request; `undefined` requests stay unprefixed. */
    sessionId: string | undefined;
    /** Host classification of the call. Background calls never carry a hint. */
    requestClass: RequestClass;
    /** Identity of the compacted-away parent session, when one is known. */
    parentSessionId?: string | undefined;
    /** Coordinator cache policy, when configured. */
    cacheControl?: AgentHintCacheControl | undefined;
    /** Verb a caller asked to piggyback; only `start` is ever auto-supplied. */
    sessionControl?: ControlVerb | undefined;
    /** Whether the session was created with prior history (resume/fork/replay). */
    seeded: boolean;
    /** Whether an ordinary request already carried this session's hint. */
    firstOrdinarySent: boolean;
}
/**
 * Assert that a value survives `JSON.stringify` without loss.
 *
 * Passing this check must mean the value encodes exactly as written: `NaN` and
 * `Infinity` would become `null`, functions and `undefined` would disappear,
 * `BigInt` would throw, and cycles would throw. Config that arrives from a user
 * or a platform is dynamic input, so the TypeScript types are not enough.
 */
export declare function assertJsonValue(value: unknown, path?: string, seen?: Set<object>): void;
/**
 * Reject a cache policy that cannot be serialised verbatim.
 *
 * The coordinator dispatches on `type`, so a policy without a string `type`
 * would silently do nothing, and any value that JSON would drop or reject would
 * change the hint after it was validated.
 */
export declare function assertValidCacheControl(value: unknown): asserts value is AgentHintCacheControl;
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
export declare function buildAgentHint(inputs: HintInputs): AgentHintWire | undefined;
