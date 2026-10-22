/**
 * DSH mapping onto the host-neutral hint builder.
 *
 * The inclusion rules live in `@sasimoreyang-ai/agenthint-core`; this module
 * contributes the one fact that is DSH-specific — that a defined `purpose`
 * means a background call (compaction, session title). Other hosts classify
 * their requests differently and call the core builder directly.
 *
 * @module dsh-llm-agent-hint/agent-hint
 */
import type { DeepSeekLlmApiExtensionRequest } from '@deepseek-ai/dsh-deepseek-llm-api-extensions';
import type { AgentHintCacheControl, AgentHintWire, SessionControlVerb } from './types.ts';
/** Inputs the extension collects per request; no wire knowledge leaks back out. */
export interface AgentHintInputs {
    /** Session identity of the request; `undefined` requests stay unprefixed. */
    sessionId: string | undefined;
    /** Call purpose; every defined purpose marks the call as background. */
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
 * Map a DSH request onto the core builder.
 *
 * A defined `purpose` is DSH's spelling of "this call must not perturb the live
 * session's KV-cache identity", which the core expresses as the `background`
 * request class.
 *
 * @param inputs - the per-request facts collected by the extension.
 * @returns the wire object, or `undefined` to omit the field entirely.
 */
export declare function buildAgentHint(inputs: AgentHintInputs): AgentHintWire | undefined;
