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
import { buildAgentHint as buildCoreAgentHint } from '@sasimoreyang-ai/agenthint-core';
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
export function buildAgentHint(inputs) {
    return buildCoreAgentHint({
        sessionId: inputs.sessionId,
        requestClass: inputs.purpose === undefined ? 'ordinary' : 'background',
        parentSessionId: inputs.parentSessionId,
        cacheControl: inputs.cacheControl,
        sessionControl: inputs.sessionControl,
        seeded: inputs.seeded,
        firstOrdinarySent: inputs.firstOrdinarySent,
    });
}
