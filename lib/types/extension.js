/**
 * The data-plane half of the `agent_hint` feature: a `prepareExtensions`
 * implementation for the DeepSeek Messages adapter that injects the
 * `agent_hint` field into ordinary requests of the `deepseek-agent-hint`
 * route. Preparation is also the control-plane barrier: a seeded session's
 * deferred `resume` prefetch fires here, and the request waits — bounded and
 * fail-open — for any in-flight manage verb before serialization.
 * `noteOrdinaryRequest` rides the extension `accept` transaction, so only a
 * request the endpoint actually accepted advances the `start` bookkeeping.
 *
 * @module dsh-llm-agent-hint/extension
 */
import { SessionId } from '@deepseek-ai/dsh-session';
import { buildAgentHint } from "./agent-hint.js";
/**
 * Build the route's `prepareExtensions`: barrier, hint construction, and
 * chained field preparation, with `start` bookkeeping committed on accept.
 * @param options - the chain to compose with and the optional control plane.
 * @returns a `prepareExtensions` implementation for `DeepSeekAdapterOptions`.
 */
export function agentHintPrepareExtensions(options) {
    return async (request) => {
        const sessionId = request.sessionId === undefined ? undefined : SessionId(request.sessionId);
        const model = typeof request.body['model'] === 'string' ? request.body['model'] : 'default';
        const bridge = options.bridge;
        if (bridge !== undefined && request.purpose === undefined) {
            bridge.ensureResume(sessionId, model);
            await bridge.awaitPendingOp(sessionId);
        }
        const facts = bridge?.facts(sessionId) ?? {
            // Without a control plane there is no `firstOrdinarySent` tracking, so
            // every request would re-declare `start`; suppress the verb instead.
            seeded: false,
            firstOrdinarySent: true,
            parentSessionId: undefined,
        };
        const hint = buildAgentHint({
            sessionId: request.sessionId,
            purpose: request.purpose,
            parentSessionId: facts.parentSessionId === undefined ? undefined : String(facts.parentSessionId),
            cacheControl: options.cacheControl,
            seeded: facts.seeded,
            firstOrdinarySent: facts.firstOrdinarySent,
        });
        const base = await options.chained(request);
        return {
            fields: { ...base.fields, ...hint === undefined ? {} : { agent_hint: hint } },
            async accept() {
                await base.accept();
                if (bridge !== undefined && hint !== undefined)
                    bridge.noteOrdinaryRequest(sessionId, model);
            },
        };
    };
}
