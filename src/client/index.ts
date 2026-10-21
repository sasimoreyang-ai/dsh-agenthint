/** Browser face: contribute an invisible observer through the stock composer slot. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DraftObserver } from './observer.ts'

export const name = 'agent-hint-composer'
// `slots` is the only hard dependency. The control namespace below is a runtime
// probe instead: the host publishes it only when standalone control is active,
// so a hard `inject` entry would leave this plugin pending forever in inherit
// mode and stall web boot.
export const inject = ['slots']

/**
 * Install advisory notifications through the existing authenticated Connection.
 * Missing services and failed notifications leave composing/submission unaffected.
 * @param ctx - browser plugin context owning the slot contribution and RPC lifetime.
 */
export function apply(ctx: Context): void {
  // Client and Host use the same service key with different declared faces.
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) return
  // Standalone-only service. Waiting for it here — rather than in `inject` —
  // keeps this entry active in inherit mode while still withholding the slot
  // contribution until the control plane actually exists.
  ctx.inject(['remote.agentHintSignals'], (scope) => {
    const lifetime = new AbortController()
    scope.effect(() => () => lifetime.abort(), 'agent-hint: composer RPC lifetime')
    const notify = (sessionId: string): void => {
      if (lifetime.signal.aborted) return
      void connection.rpc.call('/api', 'agentHintSignals/composing', { request: { sessionId } },
        AbortSignal.any([lifetime.signal, AbortSignal.timeout(5_000)]))
        .catch(() => undefined) // Advisory only; drafts and ordinary requests remain usable.
    }
    scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
      name: 'conversation.input.overlay', id: 'agent-hint-composing', order: 100,
      inject: () => ({ notify }),
    }, DraftObserver))
  })
}
