import { SessionId } from '@deepseek-ai/dsh-session';
import { buildAgentHint } from "./agent-hint.js";
export function installInheritedHints(ctx, cacheControl) {
    ctx.inject(['deepseekLlmApiExtensions', 'sessions'], (scope) => {
        const states = new Map();
        const remember = (session) => {
            const state = {
                seeded: session.surface.nodes.length > 0,
                accepted: false,
                ...session.header.parentSession === undefined ? {} : { parent: String(session.header.parentSession) },
            };
            states.set(String(session.id), state);
            return state;
        };
        for (const session of scope.sessions.list())
            remember(session);
        scope.on('session/created', remember, { global: true });
        scope.on('session/disposed', session => { states.delete(String(session.id)); }, { global: true });
        scope.effect(() => () => states.clear(), 'agent-hint: inherited session facts');
        scope.deepseekLlmApiExtensions.register('agent_hint', {
            prepare(request) {
                request.signal.throwIfAborted();
                if (request.sessionId === undefined || request.purpose !== undefined)
                    return;
                let state = states.get(request.sessionId);
                if (state === undefined) {
                    const session = scope.sessions.get(SessionId(request.sessionId));
                    // A caller-supplied id without a known Session is not proof of a new
                    // conversation. Include identity, but do not invent a start event.
                    state = session === undefined ? { seeded: true, accepted: false } : remember(session);
                    if (session !== undefined)
                        states.set(request.sessionId, state);
                }
                const value = buildAgentHint({
                    sessionId: request.sessionId, purpose: request.purpose,
                    seeded: state.seeded, firstOrdinarySent: state.accepted,
                    parentSessionId: state.parent, cacheControl,
                });
                const captured = state;
                return { value, accept() { captured.accepted = true; } };
            },
        });
    });
}
