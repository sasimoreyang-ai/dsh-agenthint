/**
 * Pure construction of the `agent_hint` wire field. One function owns every
 * inclusion rule, so the extension seam stays transport-only and every rule
 * is unit-testable without a coordinator: background-purpose calls stay
 * unprefixed, a session without identity stays anonymous, and the `start`
 * verb rides only the first ordinary request of a fresh session.
 *
 * @module dsh-llm-agent-hint/agent-hint
 */
import type { DeepSeekLlmApiExtensionRequest } from '@deepseek-ai/dsh-deepseek-llm-api-extensions';
import type { AgentHintCacheControl, AgentHintWire, SessionControlVerb } from './types.ts';
/** Inputs the extension collects per request; no wire knowledge leaks back out. */
export interface AgentHintInputs {
    /** Session identity of the request; `undefined` requests stay unprefixed. */
    sessionId: string | undefined;
    /**
     * Call purpose, or `undefined` for an ordinary conversation request. DSH treats
     * purposes as an open key set declared by their producer packages, so any
     * defined purpose is a background call and no purpose name is special-cased.
     */
    purpose: DeepSeekLlmApiExtensionRequest['purpose'];
    /** Identity of the compacted-away parent session, when one is known. */
    parentSessionId?: string | undefined;
    /** Coordinator cache policy, when configured. */
    cacheControl?: AgentHintCacheControl | undefined;
    /** Verb a caller asked to piggyback; only `start` is ever auto-supplied. */
    sessionControl?: SessionControlVerb | undefined;
    /** Whether the session was created with prior history (resume/fork/replay). */
    seeded: boolean;
    /** Whether an ordinary (non-background) request already carried this session's hint. */
    firstOrdinarySent: boolean;
}
/**
 * Build the `agent_hint` field for one request, or `undefined` when the
 * request must stay unprefixed. Rules, in order:
 *
 * 1. Any defined purpose is a background call that must not perturb the live
 *    session's KV-cache identity, so no hint is injected at all. DSH no longer
 *    enumerates purposes (`compaction`, `session-title`, …) in a closed union:
 *    producer packages declare them, so every name is treated the same way.
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
export declare function buildAgentHint(inputs: AgentHintInputs): AgentHintWire | undefined;
