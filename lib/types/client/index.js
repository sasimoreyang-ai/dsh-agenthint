import { DraftObserver } from "./observer.js";
export const name = 'agent-hint-composer';
// The host publishes this namespace only when standalone control is active.
// Inherit mode must not send draft RPCs to a missing control service.
export const inject = ['slots', 'remote.agentHintSignals'];
/**
 * Install advisory notifications through the existing authenticated Connection.
 * Missing services and failed notifications leave composing/submission unaffected.
 * @param ctx - browser plugin context owning the slot contribution and RPC lifetime.
 */
export function apply(ctx) {
    // Client and Host use the same service key with different declared faces.
    const connection = ctx.get('connection');
    if (connection === undefined)
        return;
    const lifetime = new AbortController();
    ctx.effect(() => () => lifetime.abort(), 'agent-hint: composer RPC lifetime');
    const notify = (sessionId) => {
        if (lifetime.signal.aborted)
            return;
        void connection.rpc.call('/api', 'agentHintSignals/composing', { request: { sessionId } }, AbortSignal.any([lifetime.signal, AbortSignal.timeout(5_000)]))
            .catch(() => undefined); // Advisory only; drafts and ordinary requests remain usable.
    };
    ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
        name: 'conversation.input.overlay', id: 'agent-hint-composing', order: 100,
        inject: () => ({ notify }),
    }, DraftObserver));
}
