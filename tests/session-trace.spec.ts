import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { Config } from '../src/config.ts'
import { HintTrace } from '../src/trace.ts'
import type { HintTraceFacts } from '../src/trace.ts'
import type { HintTraceRecord } from '../src/trace-record.ts'
import {
  HINT_TRACE_RECORD_TYPE, createSessionTraceSink, hintTraceRecordOf, readSessionTraceRecords,
} from '../src/session-trace.ts'

const SESSION = 'session-1'
const OTHER = 'session-2'
const facts = (overrides: Partial<HintTraceFacts> = {}): HintTraceFacts => ({
  plane: 'data', transport: 'chat', model: 'fixture-model',
  hint: { session_id: SESSION, session_control: { type: 'start' } }, ...overrides,
})

const record = (overrides: Partial<HintTraceRecord> = {}): HintTraceRecord => ({
  schemaVersion: 1,
  requestId: 'request-1',
  time: '2026-11-01T00:00:00.000Z',
  sessionId: SESSION,
  plane: 'data',
  transport: 'chat',
  model: 'fixture-model',
  attempt: 1,
  phase: 'result',
  outcome: 'accepted',
  httpStatus: 200,
  durationMs: 1.5,
  dispatched: true,
  hint: { session_id: SESSION, session_control: { type: 'start' } },
  ...overrides,
})

/** Independent Session: appends are legal without a store, so no host wiring is needed. */
const detached = (id = SESSION) => Session.create(SessionId(id))

describe('hint trace payload validation', () => {
  it('accepts a complete record and drops fields this build does not own', () => {
    const parsed = hintTraceRecordOf({ ...record(), secret: 'SECRET-EXTRA', hint: { ...record().hint, extra: 'SECRET-HINT' } })
    expect(parsed).toEqual(record())
    expect(JSON.stringify(parsed)).not.toContain('SECRET')
  })

  it('rejects payloads an older or hostile build could have written', () => {
    for (const data of [null, undefined, 'text', 42, [], {},
      { ...record(), schemaVersion: 2 },
      { ...record(), requestId: 7 },
      { ...record(), time: 'not-a-time' },
      { ...record(), time: 'x'.repeat(513) },
      { ...record(), attempt: 0 },
      { ...record(), attempt: 1.5 },
      { ...record(), phase: 'dispatch-extra' },
      { ...record(), outcome: 'succeeded' },
      { ...record(), plane: 'control-plane' },
      { ...record(), transport: 'http' },
      { ...record(), httpStatus: '200' },
      { ...record(), durationMs: -1 },
      { ...record(), dispatched: 'yes' },
      { ...record(), hint: undefined },
      { ...record(), hint: { session_id: '' } },
      { ...record(), hint: { session_id: SESSION, cache_control: { type: 5 } } }]) {
      expect(hintTraceRecordOf(data)).toBeUndefined()
    }
    const { httpStatus: _httpStatus, durationMs: _durationMs, dispatched: _dispatched, ...minimal } = record()
    expect(hintTraceRecordOf(minimal)).toEqual(minimal)
  })
})

describe('session log writer', () => {
  it('writes exactly one record per attempt, and only the terminal one', () => {
    const session = detached()
    const writes: HintTraceRecord[] = []
    const trace = new HintTrace({ writeSessionRecord: (value) => {
      writes.push(value)
      createSessionTraceSink({ resolveSession: () => session })(value)
    } })
    const attempt = trace.begin(facts(), 'prepared')
    attempt.dispatch()
    attempt.finish('accepted', { httpStatus: 200, dispatched: true })
    expect(writes.map(value => value.phase)).toEqual(['result'])

    const events = session.snapshotEvents()
    expect(events).toHaveLength(1)
    const committed = pluginRecordOf(events[0] as SessionEvent)
    expect(committed?.type).toBe(HINT_TRACE_RECORD_TYPE)
    expect(events[0]?.ignorable).toBe(true)
    expect(committed?.data).toEqual(writes[0])
    expect(readSessionTraceRecords(session, SESSION).records).toEqual([record({ requestId: writes[0]?.requestId,
      time: writes[0]?.time as string, durationMs: writes[0]?.durationMs as number })])
  })

  it('keeps every intermediate record on stdout while the log stays minimal', () => {
    const session = detached()
    const logged: HintTraceRecord[] = []
    const trace = new HintTrace({
      log: value => logged.push(value),
      writeSessionRecord: createSessionTraceSink({ resolveSession: () => session }),
    })
    const attempt = trace.begin(facts(), 'prepared')
    attempt.dispatch()
    attempt.finish('accepted', { httpStatus: 200, dispatched: true })
    expect(logged.map(value => value.phase)).toEqual(['prepared', 'dispatch', 'result'])
    expect(session.snapshotEvents()).toHaveLength(1)
  })

  it('bounds durable writes per session with the maxRecords window', () => {
    const session = detached()
    const warn = vi.fn()
    const sink = createSessionTraceSink({ resolveSession: () => session, maxRecords: 2, warn })
    for (let attempt = 1; attempt <= 4; attempt++) sink(record({ attempt, requestId: `request-${attempt}` }))
    expect(session.snapshotEvents()).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('budget of 2 records')
  })

  it('skips silently without a session, without the primitive, or for an unknown id', () => {
    const session = detached()
    const warn = vi.fn()
    for (const sink of [
      createSessionTraceSink({ resolveSession: () => undefined, warn }),
      createSessionTraceSink({ resolveSession: () => session, append: undefined, warn }),
      createSessionTraceSink({ warn }),
      createSessionTraceSink({ resolveSession: () => session, warn })(record({ sessionId: '' })),
    ]) {
      if (typeof sink === 'function') sink(record())
    }
    expect(session.snapshotEvents()).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('degrades to stdout when the host rejects the append', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      // Prepared but never announced: dsh-session refuses appends here.
      const unannounced = ctx.sessions.prepare(SessionId(SESSION))
      const warn = vi.fn()
      const logged: HintTraceRecord[] = []
      const trace = new HintTrace({ log: value => logged.push(value), warn,
        writeSessionRecord: createSessionTraceSink({ resolveSession: () => unannounced, warn }) })
      expect(() => trace.begin(facts()).finish('accepted', { httpStatus: 200 })).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(logged.map(value => value.phase)).toEqual(['dispatch', 'result'])
      expect(unannounced.snapshotEvents()).toHaveLength(0)
      expect(trace.snapshot(SESSION).records).toHaveLength(2)
    } finally { await ctx.fiber.dispose() }
  })

  it('never lets a throwing sink failure reach inference', () => {
    const trace = new HintTrace({ writeSessionRecord: () => { throw new Error('SECRET-SINK') } })
    const attempt = trace.begin(facts())
    expect(() => attempt.finish('accepted', { httpStatus: 200 })).not.toThrow()
    expect(trace.snapshot(SESSION).records.map(value => value.phase)).toEqual(['dispatch', 'result'])
  })
})

describe('session log reader', () => {
  it('reads records back, skips a corrupt payload and warns instead of throwing', () => {
    const session = detached()
    appendPluginRecord(session, HINT_TRACE_RECORD_TYPE, record({ requestId: 'kept' }))
    appendPluginRecord(session, HINT_TRACE_RECORD_TYPE, { schemaVersion: 99, requestId: 'corrupt' } as never)
    appendPluginRecord(session, HINT_TRACE_RECORD_TYPE, record({ requestId: 'foreign', sessionId: OTHER }))
    const warn = vi.fn()
    const read = readSessionTraceRecords(session, SESSION, warn)
    expect(read.read).toBe(true)
    expect(read.records.map(value => value.requestId)).toEqual(['kept'])
    expect(read.invalid).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('reports an unreadable log instead of failing the export', () => {
    const broken = { snapshotEvents: () => { throw new Error('SECRET-READ') } } as unknown as Session
    expect(readSessionTraceRecords(broken, SESSION)).toEqual({ records: [], invalid: 0, read: false })
  })
})

describe('merged download snapshot', () => {
  // The Gateway service itself is exercised in tests/trace.test.mjs: its module
  // carries stage-3 decorators, which only the built lib can run here.
  it('merges the window with the log, deduplicates the shared attempt and labels both sources', () => {
    const session = detached()
    const trace = new HintTrace({ writeSessionRecord: createSessionTraceSink({ resolveSession: () => session }) })
    const attempt = trace.begin(facts())
    attempt.finish('accepted', { httpStatus: 200 })
    // An earlier run's record only exists in the log.
    appendPluginRecord(session, HINT_TRACE_RECORD_TYPE,
      record({ requestId: 'earlier', time: '2026-10-31T00:00:00.000Z' }))
    const merged = trace.snapshot(SESSION, readSessionTraceRecords(session, SESSION))
    expect(merged.schemaVersion).toBe(2)
    // The terminal record exists in both sources; `requestId+phase+attempt+time` keeps one.
    expect(merged.records.map(value => [value.requestId, value.phase])).toEqual([
      ['earlier', 'result'],
      [attempt.requestId, 'dispatch'],
      [attempt.requestId, 'result'],
    ])
    expect(merged.sources).toEqual({
      processWindow: { retention: 'process-local', records: 2 },
      sessionLog: { retention: 'session-log', recordType: HINT_TRACE_RECORD_TYPE,
        read: true, records: 2, invalidRecords: 0 },
      dedupe: 'requestId+phase+attempt+time',
    })
  })

  it('isolates sessions and reports an unreadable log as window only', () => {
    const session = detached()
    const trace = new HintTrace()
    trace.begin(facts()).finish('accepted', { httpStatus: 200 })
    trace.begin(facts({ hint: { session_id: OTHER } })).finish('accepted', { httpStatus: 200 })
    expect(trace.snapshot(SESSION, readSessionTraceRecords(session, SESSION)).sources.sessionLog)
      .toEqual({ retention: 'session-log', recordType: HINT_TRACE_RECORD_TYPE, read: true, records: 0, invalidRecords: 0 })
    const unavailable = trace.snapshot(SESSION)
    expect(unavailable.records).toHaveLength(2)
    expect(unavailable.sources.sessionLog).toEqual({ retention: 'session-log', recordType: HINT_TRACE_RECORD_TYPE,
      read: false, records: 0, invalidRecords: 0 })
  })

  it('reports corrupted records without exporting them', () => {
    const session = detached()
    appendPluginRecord(session, HINT_TRACE_RECORD_TYPE, { schemaVersion: 1 } as never)
    const snapshot = new HintTrace().snapshot(SESSION, readSessionTraceRecords(session, SESSION))
    expect(snapshot.records).toEqual([])
    expect(snapshot.sources.sessionLog.invalidRecords).toBe(1)
  })
})

describe('configuration', () => {
  it('mirrors into the session log by default and can be switched off', () => {
    expect(Config({}).agentHint.trace).toEqual({ enabled: true, maxRecords: 2000, writeToSession: true })
    expect(Config({ agentHint: { trace: { writeToSession: false } } }).agentHint.trace.writeToSession).toBe(false)
    expect(Config({ agentHint: { trace: { enabled: false } } }).agentHint.trace.enabled).toBe(false)
  })

  it('writes nothing to the session log while disabled, and stdout keeps working', () => {
    const session = detached()
    const logged: HintTraceRecord[] = []
    const enabled = new HintTrace({ log: value => logged.push(value),
      writeSessionRecord: createSessionTraceSink({ resolveSession: () => session }) })
    enabled.begin(facts()).finish('accepted', { httpStatus: 200 })
    expect(session.snapshotEvents()).toHaveLength(1)

    const disabled = new HintTrace({ enabled: false, log: () => { throw new Error('must not log') },
      writeSessionRecord: createSessionTraceSink({ resolveSession: () => session }) })
    disabled.begin(facts()).finish('accepted', { httpStatus: 200 })
    expect(session.snapshotEvents()).toHaveLength(1)
    expect(disabled.snapshot(SESSION).records).toHaveLength(0)
  })
})

describe('model-visible surface', () => {
  it('never enters the surface: no nodes, no derived messages, no surface metadata', () => {
    const session = detached()
    const before = session.surface.nodes.length
    const sink = createSessionTraceSink({ resolveSession: () => session })
    for (let attempt = 1; attempt <= 3; attempt++) sink(record({ attempt, requestId: `request-${attempt}` }))
    expect(session.surface.nodes.length).toBe(before)
    expect(session.deriveMessages()).toEqual([])
    for (const event of session.snapshotEvents()) {
      expect(event.ignorable).toBe(true)
      expect('surfaceOp' in event).toBe(false)
      expect('sourceEventSeqs' in event).toBe(false)
    }
  })
})
