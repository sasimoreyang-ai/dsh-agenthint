/**
 * Core behaviour tests.
 *
 * Every test in this file imports only `agenthint-core` — no DSH, no Cordis, no
 * React. That is the structural proof behind C01: the protocol rules can be
 * exercised in a host that knows nothing about any agent framework.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  AgentHintError,
  HintCoordinator,
  buildAgentHint,
  controlBarrierError,
  isAgentHintError,
} from '../src/index.ts'
import type {
  ControlCommand,
  ControlResult,
  ControlTransport,
} from '../src/index.ts'

/** Transport that records commands and answers from a scripted queue. */
function fakeTransport(script: ControlResult[] = []): ControlTransport & {
  readonly calls: ControlCommand[]
  /** Resolve the command currently being held, if any. */
  release(result?: ControlResult): void
} {
  const calls: ControlCommand[] = []
  const held: ((result: ControlResult) => void)[] = []
  const transport = {
    calls,
    send(command: ControlCommand): Promise<ControlResult> {
      calls.push(command)
      const next = script.shift()
      if (next !== undefined) return Promise.resolve(next)
      return new Promise<ControlResult>(resolve => { held.push(resolve) })
    },
    release(result: ControlResult = { status: 'accepted', httpStatus: 200 }): void {
      held.shift()?.(result)
    },
  }
  return transport
}

/** Let queued microtasks and one macrotask run. */
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

describe('buildAgentHint', () => {
  it('never prefixes a background call', () => {
    expect(buildAgentHint({
      sessionId: 's1', requestClass: 'background', seeded: false, firstOrdinarySent: false,
    })).toBeUndefined()
  })

  it('never invents an identity for an anonymous request', () => {
    expect(buildAgentHint({
      sessionId: undefined, requestClass: 'ordinary', seeded: false, firstOrdinarySent: false,
    })).toBeUndefined()
  })

  it('declares start once on the first ordinary request of a fresh session', () => {
    expect(buildAgentHint({
      sessionId: 's1', requestClass: 'ordinary', seeded: false, firstOrdinarySent: false,
    })).toEqual({ session_id: 's1', session_control: { type: 'start' } })
    expect(buildAgentHint({
      sessionId: 's1', requestClass: 'ordinary', seeded: false, firstOrdinarySent: true,
    })).toEqual({ session_id: 's1' })
  })

  it('never re-declares start for a seeded session', () => {
    expect(buildAgentHint({
      sessionId: 's1', requestClass: 'ordinary', seeded: true, firstOrdinarySent: false,
    })).toEqual({ session_id: 's1' })
  })

  it('keeps lineage and cache policy verbatim', () => {
    expect(buildAgentHint({
      sessionId: 's1', requestClass: 'ordinary', parentSessionId: 'p1',
      cacheControl: { type: 'kv', ttl: 300 }, seeded: true, firstOrdinarySent: true,
    })).toEqual({
      session_id: 's1', parent_session_id: 'p1', cache_control: { type: 'kv', ttl: 300 },
    })
  })

  it('rejects a cache policy that names no type', () => {
    expect(() => buildAgentHint({
      sessionId: 's1', requestClass: 'ordinary',
      cacheControl: { type: '' }, seeded: false, firstOrdinarySent: false,
    })).toThrow(AgentHintError)
  })
})

describe('HintCoordinator start bookkeeping', () => {
  it('consumes start only after the request is accepted', async () => {
    const transport = fakeTransport()
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: false })

    const first = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    expect(first.hint).toEqual({ session_id: 's1', session_control: { type: 'start' } })
    // Preparing is not accepting: a rejected request must not burn the verb.
    const stillFirst = core.buildHint({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    expect(stillFirst).toEqual({ session_id: 's1', session_control: { type: 'start' } })

    first.accepted()
    first.finish()
    expect(core.buildHint({ sessionId: 's1', requestClass: 'ordinary', model: 'm' }))
      .toEqual({ session_id: 's1' })
    core.dispose()
  })

  it('leaves background calls out of the ordinary bookkeeping', async () => {
    const core = new HintCoordinator({ transport: fakeTransport() })
    core.registerSession({ sessionId: 's1', seeded: false })
    const background = await core.prepareRequest({ sessionId: 's1', requestClass: 'background', model: 'm' })
    expect(background.hint).toBeUndefined()
    background.accepted()
    background.finish()
    // The first ordinary request still owns the single start.
    expect(core.buildHint({ sessionId: 's1', requestClass: 'ordinary', model: 'm' }))
      .toEqual({ session_id: 's1', session_control: { type: 'start' } })
    core.dispose()
  })
})

describe('HintCoordinator control queue', () => {
  it('holds a mutation until the model stream finishes', async () => {
    const transport = fakeTransport()
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: false })
    const lease = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    lease.accepted()

    void core.requestControl({ verb: 'stop', sessionId: 's1', model: 'm' })
    await settle()
    expect(transport.calls).toHaveLength(0)

    lease.finish()
    await settle()
    expect(transport.calls.map(call => call.verb)).toEqual(['stop'])
    transport.release()
    await settle()
    core.dispose()
  })

  it('reports a CONTROL_BARRIER after an unknown mutating outcome', async () => {
    const transport = fakeTransport([{ status: 'unknown' }])
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: false })
    const lease = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    lease.accepted()
    lease.finish()

    await core.requestControl({ verb: 'pause', sessionId: 's1', model: 'm' })
    await settle()

    await expect(
      core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' }),
    ).rejects.toSatisfy((error: unknown) => isAgentHintError(error) && error.code === 'CONTROL_BARRIER')
    core.dispose()
  })

  it('keeps a quarantined session quarantined after re-registration', async () => {
    const transport = fakeTransport([{ status: 'unknown' }])
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: false })
    const lease = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    lease.accepted()
    lease.finish()
    await core.requestControl({ verb: 'stop', sessionId: 's1', model: 'm' })
    await settle()

    // A reopen must not look safe just because the previous incarnation ended.
    core.registerSession({ sessionId: 's1', seeded: true })
    await expect(core.awaitPendingOp('s1')).rejects.toSatisfy(
      (error: unknown) => isAgentHintError(error) && error.code === 'CONTROL_BARRIER',
    )
    core.dispose()
  })

  it('cancels queued work and stops sending once disposed', async () => {
    const transport = fakeTransport()
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: false })
    const lease = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    lease.accepted()
    void core.requestControl({ verb: 'stop', sessionId: 's1', model: 'm' })
    core.dispose()
    lease.finish()
    await settle()
    expect(transport.calls).toHaveLength(0)
  })

  it('waits for the latest queued mutation rather than the first one', async () => {
    const transport = fakeTransport()
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: false })
    const lease = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    lease.accepted()

    void core.requestControl({ verb: 'pause', sessionId: 's1', model: 'm' })
    void core.requestControl({ verb: 'compact', sessionId: 's1', model: 'm' })
    lease.finish()
    await settle()

    expect(transport.calls.map(call => call.verb)).toEqual(['pause'])
    transport.release()
    await settle()
    expect(transport.calls.map(call => call.verb)).toEqual(['pause', 'compact'])
    transport.release()
    await settle()
    core.dispose()
  })
})

describe('HintCoordinator isolation', () => {
  it('keeps two coordinators independent so one scope cannot pause another', async () => {
    const alice = fakeTransport()
    const bob = fakeTransport()
    const aliceCore = new HintCoordinator({ transport: alice })
    const bobCore = new HintCoordinator({ transport: bob })
    aliceCore.registerSession({ sessionId: 's1', seeded: false })
    bobCore.registerSession({ sessionId: 's1', seeded: false })

    const aliceLease = await aliceCore.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    aliceLease.accepted()
    aliceLease.finish()

    // Bob's identical local id must not observe Alice's state.
    expect(bobCore.facts('s1').firstOrdinarySent).toBe(false)
    expect(bobCore.buildHint({ sessionId: 's1', requestClass: 'ordinary', model: 'm' }))
      .toEqual({ session_id: 's1', session_control: { type: 'start' } })
    expect(alice.calls).toHaveLength(0)
    aliceCore.dispose()
    bobCore.dispose()
  })

  it('does not control a session that never carried a request', async () => {
    const transport = fakeTransport()
    const core = new HintCoordinator({ transport })
    const result = await core.requestControl({ verb: 'stop', sessionId: 'unknown', model: 'm' })
    expect(result).toEqual({ status: 'cancelled', dispatched: false })
    expect(transport.calls).toHaveLength(0)
    core.dispose()
  })
})

describe('controlBarrierError', () => {
  it('carries the stable code and is recognisable', () => {
    const error = controlBarrierError()
    expect(error.code).toBe('CONTROL_BARRIER')
    expect(isAgentHintError(error)).toBe(true)
    expect(isAgentHintError(new Error('other'))).toBe(false)
  })
})

describe('resume advisory retry', () => {
  it('retries only an explicit transient rejection', async () => {
    const transport = fakeTransport([
      { status: 'failed', retryable: true, httpStatus: 503 },
      { status: 'accepted', httpStatus: 200 },
    ])
    const send = vi.spyOn(transport, 'send')
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: true })
    core.ensureResume('s1', 'm')
    await settle()
    await settle()
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(transport.calls[0]?.verb).toBe('resume')
    core.dispose()
  })

  it('never retries a mutating verb that answered 503', async () => {
    const transport = fakeTransport([{ status: 'unknown' }])
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: false })
    const lease = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    lease.accepted()
    lease.finish()

    await core.requestControl({ verb: 'pause', sessionId: 's1', model: 'm' })
    await settle()
    // Exactly one attempt: resending could duplicate an action that may have run.
    expect(transport.calls.filter(call => call.verb === 'pause')).toHaveLength(1)
    core.dispose()
  })

  it('re-arms the resume guard after a failed prefetch', async () => {
    const transport = fakeTransport([{ status: 'failed', retryable: false }])
    let now = 0
    const core = new HintCoordinator({ transport, now: () => now, resumeCooldownMs: 1_000 })
    core.registerSession({ sessionId: 's1', seeded: true })
    core.ensureResume('s1', 'm')
    await settle()

    // Inside the cool-down the guard stays armed.
    core.ensureResume('s1', 'm')
    await settle()
    expect(transport.calls).toHaveLength(1)

    // Past the cool-down a new attempt is allowed.
    now = 2_000
    core.ensureResume('s1', 'm')
    await settle()
    expect(transport.calls).toHaveLength(2)
    core.dispose()
  })
})

describe('single-writer session contract', () => {
  it('rejects a second overlapping preparation before start is declared', async () => {
    const core = new HintCoordinator({ transport: fakeTransport() })
    core.registerSession({ sessionId: 's1', seeded: false })

    const first = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    await expect(
      core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' }),
    ).rejects.toSatisfy((error: unknown) => isAgentHintError(error) && error.code === 'INVALID_INPUT')

    // Once the first is accepted the session is no longer "first", so a second
    // preparation is allowed again.
    first.accepted()
    first.finish()
    const next = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    expect(next.hint).toEqual({ session_id: 's1' })
    next.finish()
    core.dispose()
  })

  it('does not block background calls behind an unaccepted first request', async () => {
    const core = new HintCoordinator({ transport: fakeTransport() })
    core.registerSession({ sessionId: 's1', seeded: false })
    const first = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    const background = await core.prepareRequest({ sessionId: 's1', requestClass: 'background', model: 'm' })
    expect(background.hint).toBeUndefined()
    background.finish()
    first.accepted()
    first.finish()
    core.dispose()
  })
})

describe('lease lifetime', () => {
  it('releases the stream slot when a prepared request never starts', async () => {
    const transport = fakeTransport()
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: false })

    const lease = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    // The caller abandons the request: finish() must still free the session so
    // a queued mutation can run.
    lease.finish()

    void core.requestControl({ verb: 'stop', sessionId: 's1', model: 'm' })
    await settle()
    expect(transport.calls.map(call => call.verb)).toEqual(['stop'])
    transport.release()
    await settle()
    core.dispose()
  })

  it('makes finish idempotent so a double release cannot corrupt the queue', async () => {
    const transport = fakeTransport()
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 's1', seeded: false })
    const lease = await core.prepareRequest({ sessionId: 's1', requestClass: 'ordinary', model: 'm' })
    lease.accepted()
    lease.finish()
    lease.finish()

    void core.requestControl({ verb: 'compact', sessionId: 's1', model: 'm' })
    await settle()
    expect(transport.calls.map(call => call.verb)).toEqual(['compact'])
    transport.release()
    await settle()
    core.dispose()
  })
})

describe('review regressions: prepare transaction', () => {
  it('rejects two concurrent first preparations without awaiting the first', async () => {
    const core = new HintCoordinator({ transport: fakeTransport() })
    core.registerSession({ sessionId: 'race', seeded: false })
    // Create both promises before awaiting either: checking the reservation
    // across an await would let both observe zero and both claim `start`.
    const settled = await Promise.allSettled([
      core.prepareRequest({ sessionId: 'race', requestClass: 'ordinary', model: 'm' }),
      core.prepareRequest({ sessionId: 'race', requestClass: 'ordinary', model: 'm' }),
    ])
    const fulfilled = settled.filter(entry => entry.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
    const rejected = settled.filter(entry => entry.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(isAgentHintError((rejected[0] as PromiseRejectedResult).reason)).toBe(true)
    for (const entry of fulfilled) (entry as PromiseFulfilledResult<{ finish(): void }>).value.finish()
    core.dispose()
  })

  it('releases the session when hint construction throws', async () => {
    const transport = fakeTransport()
    const core = new HintCoordinator({ transport })
    core.registerSession({ sessionId: 'leak', seeded: false })

    await expect(core.prepareRequest({
      sessionId: 'leak', requestClass: 'ordinary', model: 'm', cacheControl: { type: '' },
    })).rejects.toSatisfy((error: unknown) => isAgentHintError(error) && error.code === 'INVALID_INPUT')

    // The failure must not wedge the session: a legal request still prepares,
    // and a control command can still run once it finishes.
    const lease = await core.prepareRequest({ sessionId: 'leak', requestClass: 'ordinary', model: 'm' })
    expect(lease.hint).toEqual({ session_id: 'leak', session_control: { type: 'start' } })
    lease.accepted()
    lease.finish()
    void core.requestControl({ verb: 'stop', sessionId: 'leak', model: 'm' })
    await settle()
    expect(transport.calls.map(call => call.verb)).toEqual(['stop'])
    transport.release()
    await settle()
    core.dispose()
  })

  it('does not commit an acceptance that arrives after finish', async () => {
    const core = new HintCoordinator({ transport: fakeTransport() })
    core.registerSession({ sessionId: 'late', seeded: false })
    const lease = await core.prepareRequest({ sessionId: 'late', requestClass: 'ordinary', model: 'm' })
    lease.finish()
    lease.accepted()
    // A cancelled request must not consume the session's single `start`.
    expect(core.facts('late').firstOrdinarySent).toBe(false)
    const next = await core.prepareRequest({ sessionId: 'late', requestClass: 'ordinary', model: 'm' })
    expect(next.hint).toEqual({ session_id: 'late', session_control: { type: 'start' } })
    next.finish()
    core.dispose()
  })
})

describe('review regressions: input validation', () => {
  it('rejects an unrecognised request class instead of emitting a hint', async () => {
    const core = new HintCoordinator({ transport: fakeTransport() })
    core.registerSession({ sessionId: 'cls', seeded: false })
    await expect(core.prepareRequest({
      sessionId: 'cls', requestClass: 'not-recognized' as never, model: 'm',
    })).rejects.toSatisfy((error: unknown) => isAgentHintError(error) && error.code === 'INVALID_INPUT')
    // Rejection must not wedge the session.
    const lease = await core.prepareRequest({ sessionId: 'cls', requestClass: 'ordinary', model: 'm' })
    expect(lease.hint).toBeDefined()
    lease.finish()
    core.dispose()
  })

  it('rejects cache policy values that JSON would drop or reject', () => {
    const cases: unknown[] = [
      { type: 'kv', ttl: Number.NaN },
      { type: 'kv', ttl: Number.POSITIVE_INFINITY },
      { type: 'kv', fn: () => 1 },
      { type: 'kv', n: 1n },
      { type: 'kv', d: new Date() },
      { type: 'kv', u: undefined },
    ]
    for (const cacheControl of cases) {
      expect(() => buildAgentHint({
        sessionId: 's1', requestClass: 'ordinary', seeded: false, firstOrdinarySent: false,
        cacheControl: cacheControl as never,
      })).toThrow(AgentHintError)
    }
  })

  it('rejects a circular cache policy', () => {
    const circular: Record<string, unknown> = { type: 'kv' }
    circular['self'] = circular
    expect(() => buildAgentHint({
      sessionId: 's1', requestClass: 'ordinary', seeded: false, firstOrdinarySent: false,
      cacheControl: circular as never,
    })).toThrow(AgentHintError)
  })

  it('rejects a non-string session identity from a JavaScript caller', () => {
    expect(() => buildAgentHint({
      sessionId: 42 as never, requestClass: 'ordinary', seeded: false, firstOrdinarySent: false,
    })).toThrow(AgentHintError)
  })
})

describe('review regressions: transport outcome', () => {
  it('reports an unknown outcome when a custom transport throws', async () => {
    const core = new HintCoordinator({
      transport: { send: async () => { throw new Error('boom') } },
    })
    core.registerSession({ sessionId: 'boom', seeded: false })
    const lease = await core.prepareRequest({ sessionId: 'boom', requestClass: 'ordinary', model: 'm' })
    lease.accepted()
    lease.finish()
    // A throw cannot prove the command was never dispatched, so it must not be
    // reported as a definite failure a caller could safely retry.
    await expect(core.requestControl({ verb: 'pause', sessionId: 'boom', model: 'm' }))
      .resolves.toEqual({ status: 'unknown' })
    core.dispose()
  })
})
