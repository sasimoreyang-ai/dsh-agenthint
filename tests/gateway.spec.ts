import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { SessionId } from '@deepseek-ai/dsh-session'
// Exercise the shipped decorator output, as plain Node and the host Loader do.
import { AgentHintSignals } from '../lib/types/composing-service.js'
import { LifecycleBridge } from '../src/lifecycle-bridge.ts'
import type { SessionControlClient } from '../src/control-client.ts'

let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined })
describe('stock rc.2 Gateway', () => {
  it('discovers a third-party Remote method at runtime and withdraws it on unload', async () => {
    ctx = new Context()
    const calls: string[] = []
    const client = { send: (verb: string, id: string) => { calls.push(`${verb}:${id}`); return Promise.resolve({ status: 'accepted', httpStatus: 200 }) } } as SessionControlClient
    const bridge = new LifecycleBridge({ client, pendingOpAwaitMs: 20 })
    const a = SessionId('owned-a'), b = SessionId('owned-b')
    bridge.noteOrdinaryRequest(a, 'model')
    bridge.noteOrdinaryRequest(b, 'model')
    calls.length = 0
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
    const fiber = await ctx.plugin(AgentHintSignals, bridge)
    const gateway = ctx.get('typertGateway')!
    expect(await gateway.invoke({ namespace: 'agentHintSignals', method: 'available', args: {} })).toBe(true)
    expect(calls).toEqual([])
    await gateway.invoke({ namespace: 'agentHintSignals', method: 'activated', args: { request: { sessionId: 'owned-a' } } })
    await gateway.invoke({ namespace: 'agentHintSignals', method: 'composing', args: { request: { sessionId: 'owned-a' } } })
    expect(calls).toEqual(['resume:owned-a'])
    for (const request of [{ sessionId: 'unrelated' }, { sessionId: 'owned-a', draft: 'private text' }, null]) {
      for (const method of ['activated', 'composing']) {
        await gateway.invoke({ namespace: 'agentHintSignals', method, args: { request } })
      }
    }
    expect(calls).toEqual(['resume:owned-a'])
    bridge.onSessionArchived(a)
    const beforeArchivedActivation = calls.slice()
    await gateway.invoke({ namespace: 'agentHintSignals', method: 'activated', args: { request: { sessionId: a } } })
    expect(calls).toEqual(beforeArchivedActivation)
    await fiber.dispose()
    await expect(gateway.invoke({ namespace: 'agentHintSignals', method: 'available', args: {} })).rejects.toThrow()
    for (const method of ['activated', 'composing']) {
      await expect(gateway.invoke({ namespace: 'agentHintSignals', method, args: { request: { sessionId: 'owned-a' } } })).rejects.toThrow()
    }
  })
})
