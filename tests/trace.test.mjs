import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import { Config } from '../lib/types/config.js'
import { HintTrace } from '../lib/types/trace.js'
import { SessionControlClient } from '../lib/types/control-client.js'
import { ChatCompletionsAdapter } from '../lib/types/chat-adapter.js'
import { agentHintPrepareExtensions } from '../lib/types/extension.js'
import { LifecycleBridge } from '../lib/types/lifecycle-bridge.js'
import * as plugin from '../lib/types/index.js'

const session = 'session-fixture'
const hint = { session_id: session, session_control: { type: 'start' } }
const facts = { plane: 'data', transport: 'chat', model: 'fixture-model', hint }
const records = trace => trace.recordsOf(session)
const client = (trace, options = {}) => new SessionControlClient({
  endpoint: 'http://fixture.invalid/v1/chat/completions',
  resolveApiKey: async () => 'SECRET-KEY', model: 'fixture-model', timeoutMs: 1000, retries: 0,
  trace, ...options,
})

test('trace config defaults on, can be disabled and bounds memory', () => {
  assert.deepEqual(Config({}).agentHint.trace, { enabled: true, maxRecords: 2000, writeToSession: true })
  assert.equal(Config({ agentHint: { trace: { enabled: false } } }).agentHint.trace.enabled, false)
  assert.equal(Config({ agentHint: { trace: { writeToSession: false } } }).agentHint.trace.writeToSession, false)
  for (const maxRecords of [0, -1, 10_001, 1.2]) {
    assert.throws(() => Config({ agentHint: { trace: { maxRecords } } }))
    assert.throws(() => new HintTrace({ maxRecords }))
  }
  assert.throws(() => new HintTrace({ maxRecords: NaN }))
  const trace = new HintTrace({ maxRecords: 2 })
  for (let i = 0; i < 3; i++) trace.begin(facts).finish('accepted', { httpStatus: 200 })
  assert.equal(records(trace).length, 2)
  assert.equal(trace.recordsOf('other').length, 0)
})

test('records are detached, allowlisted, bounded and sink failures are harmless', () => {
  const trace = new HintTrace({ log: value => { value.hint.session_id = 'mutated'; throw Error('logger failed') } })
  const source = { ...structuredClone(hint), cache_control: { type: 'default', secret: 'SECRET-CACHE' }, extra: 'SECRET-EXTRA' }
  const attempt = trace.begin({ ...facts, hint: source, model: 'x'.repeat(4000) }, 'prepared')
  source.session_control.type = 'pause'
  attempt.dispatch()
  attempt.finish('accepted', { httpStatus: 200, dispatched: true })
  attempt.finish('unknown')
  const snapshot = trace.recordsOf(session)
  assert.equal(snapshot.length, 3)
  assert.equal(snapshot[0].hint.session_control.type, 'start')
  assert.equal(snapshot[0].model.length, 512)
  assert.ok(snapshot.every(row => row.requestId === attempt.requestId))
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false)
  snapshot[0].hint.session_id = 'changed'
  assert.equal(records(trace)[0].hint.session_id, session)
  assert.ok(records(trace)[2].durationMs >= 0)
})

for (const verb of ['pause', 'resume', 'stop', 'compact']) {
  test(`control ${verb} trace matches the wire and 2xx acceptance`, async t => {
    const trace = new HintTrace()
    let body
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      body = JSON.parse(init.body)
      assert.equal(records(trace).at(-1).phase, 'dispatch')
      return new Response('{}', { status: 200 })
    })
    assert.equal((await client(trace).send(verb, session)).status, 'accepted')
    const rows = records(trace)
    assert.deepEqual(rows.map(row => row.phase), ['prepared', 'dispatch', 'result'])
    assert.deepEqual(rows[1].hint, body.agent_hint)
    assert.equal(rows[2].outcome, 'accepted')
    assert.equal(rows[2].httpStatus, 200)
    assert.equal(JSON.stringify(rows).includes('SECRET-KEY'), false)
    assert.equal(JSON.stringify(rows).includes('messages'), false)
  })
}

test('resume retries retain correlation ID and distinguish attempts', async t => {
  const trace = new HintTrace()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: ++calls === 1 ? 429 : 200 }))
  assert.equal((await client(trace, { retries: 1 }).send('resume', session)).status, 'accepted')
  const ends = records(trace).filter(row => row.phase === 'result')
  assert.deepEqual(ends.map(row => [row.attempt, row.outcome, row.httpStatus]), [[1, 'rejected', 429], [2, 'accepted', 200]])
  assert.equal(ends[0].requestId, ends[1].requestId)
})

test('ambiguous mutating HTTP errors are unknown, not proof of rejection', async t => {
  const trace = new HintTrace()
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }))
  assert.equal((await client(trace, { retries: 2 }).send('pause', session)).status, 'unknown')
  assert.equal(records(trace).at(-1).outcome, 'unknown')
  assert.equal(records(trace).at(-1).httpStatus, 503)
  assert.equal(fetch.mock.callCount(), 1)
})

test('network errors and truncated control bodies never report success', async t => {
  for (const implementation of [async () => { throw Error('SECRET-NETWORK') }, async () => ({
    ok: true, status: 200, arrayBuffer: async () => { throw Error('SECRET-BODY') },
  })]) {
    const trace = new HintTrace()
    const mocked = t.mock.method(globalThis, 'fetch', implementation)
    assert.equal((await client(trace).send('stop', session)).status, 'unknown')
    assert.equal(records(trace).at(-1).outcome, 'unknown')
    assert.equal(JSON.stringify(records(trace)).includes('SECRET'), false)
    mocked.mock.restore()
  }
})

test('connection failure and pre-dispatch cancellation are recorded without HTTP activity', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('must not send') })
  const trace = new HintTrace()
  await client(trace, { resolveApiKey: async () => { throw Error('SECRET-RESOLVE') } }).send('pause', session)
  assert.equal(records(trace).at(-1).outcome, 'not-dispatched')
  assert.equal(records(trace).at(-1).dispatched, false)
  const cancel = new AbortController(); cancel.abort()
  await client(trace).send('pause', session, undefined, cancel.signal)
  assert.equal(records(trace).at(-1).outcome, 'cancelled')
  assert.equal(records(trace).at(-1).dispatched, false)
  assert.equal(fetch.mock.callCount(), 0)
})

test('post-dispatch cancellation remains distinguished from unsent control', async t => {
  const trace = new HintTrace(), cancel = new AbortController()
  t.mock.method(globalThis, 'fetch', async () => { cancel.abort(); throw Error('aborted') })
  const result = await client(trace).send('pause', session, undefined, cancel.signal)
  assert.deepEqual(result, { status: 'cancelled', dispatched: true })
  assert.equal(records(trace).at(-1).outcome, 'cancelled')
  assert.equal(records(trace).at(-1).dispatched, true)
})

test('control transport timeout records unknown with no fabricated HTTP status', async t => {
  const trace = new HintTrace()
  t.mock.method(globalThis, 'fetch', async (_url, init) => new Promise((resolve, reject) => {
    const keepAlive = setTimeout(() => reject(Error('timeout did not fire')), 1000)
    init.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(init.signal.reason) }, { once: true })
  }))
  assert.equal((await client(trace, { timeoutMs: 10 }).send('pause', session)).status, 'unknown')
  assert.equal(records(trace).at(-1).outcome, 'unknown')
  assert.equal(records(trace).at(-1).dispatched, true)
  assert.equal(records(trace).at(-1).httpStatus, undefined)
})

function chat(trace, resolveAuth = async () => ({ headers: { authorization: 'SECRET-KEY' } }), prepareHint = () => ({ session_id: session, session_control: { type: 'start' } })) {
  return new ChatCompletionsAdapter({
    options: () => ({ baseURL: 'http://fixture.invalid', models: [{ id: 'fixture-model' }] }),
    trace, resolveAuth, prepareHint,
  })
}
const generate = adapter => Array.fromAsync(adapter.stream({
  provider: 'deepseek-agent-hint', model: 'fixture-model', sessionId: session,
  messages: [{ role: 'user', content: 'SECRET-PROMPT' }],
}))
const sse = 'data: {"choices":[{"delta":{"content":"READY"},"finish_reason":null}]}\n\n'
  + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

test('ordinary chat logs actual wire hint and 2xx headers without prompt or key', async t => {
  const trace = new HintTrace()
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.deepEqual(records(trace).at(-1).hint, JSON.parse(init.body).agent_hint)
    assert.equal(records(trace).at(-1).phase, 'dispatch')
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } })
  })
  const chunks = await generate(chat(trace))
  assert.ok(chunks.length > 0)
  const rows = records(trace)
  assert.equal(rows.at(-1).outcome, 'accepted')
  assert.equal(rows.at(-1).httpStatus, 200)
  assert.equal(JSON.stringify(rows).includes('SECRET'), false)
})

test('ordinary auth failures are unsent, HTTP errors rejected, network failures unknown', async t => {
  const trace = new HintTrace()
  await assert.rejects(generate(chat(trace, async () => { throw Error('SECRET-AUTH') })))
  assert.equal(records(trace).at(-1).outcome, 'not-dispatched')
  const mocked = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 400 }))
  await assert.rejects(generate(chat(trace)))
  assert.equal(records(trace).at(-1).outcome, 'rejected')
  mocked.mock.restore()
  t.mock.method(globalThis, 'fetch', async () => { throw Error('SECRET-NETWORK') })
  await assert.rejects(generate(chat(trace)))
  assert.equal(records(trace).at(-1).outcome, 'unknown')
  assert.equal(JSON.stringify(records(trace)).includes('SECRET'), false)
})

test('a stream failure after HTTP acceptance does not fabricate a second HTTP outcome', async t => {
  const trace = new HintTrace()
  t.mock.method(globalThis, 'fetch', async () => new Response('data: bad-json\n\n'))
  await assert.rejects(generate(chat(trace)))
  assert.deepEqual(records(trace).filter(row => row.phase === 'result').map(row => row.outcome), ['accepted'])
})

test('hintless and trace-disabled ordinary requests generate without diagnostic rows', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(sse))
  const trace = new HintTrace()
  await generate(chat(trace, undefined, () => undefined))
  assert.equal(records(trace).length, 0)
  const disabled = new HintTrace({ enabled: false })
  await generate(chat(disabled))
  assert.equal(records(disabled).length, 0)
})

test('Messages exposes only preparation and post-2xx acceptance, not invented dispatch/status', async () => {
  const trace = new HintTrace()
  const prepare = agentHintPrepareExtensions({ trace,
    chained: async () => ({ fields: {}, accept: async () => {} }),
  })
  const prepared = await prepare({ body: { model: 'fixture-model' }, sessionId: session, signal: new AbortController().signal })
  assert.deepEqual(records(trace).map(row => row.phase), ['prepared'])
  assert.deepEqual(records(trace)[0].hint, prepared.fields.agent_hint)
  await prepared.accept()
  await prepared.accept()
  assert.deepEqual(records(trace).map(row => row.outcome), ['prepared', 'accepted'])
  assert.equal(records(trace).at(-1).httpStatus, undefined)
  assert.equal(records(trace).at(-1).dispatched, undefined)
})

test('real plugin wiring appends exactly one terminal record per attempt to the Session log', async t => {
  let bridge
  const subscribe = LifecycleBridge.prototype.subscribe
  t.mock.method(LifecycleBridge.prototype, 'subscribe', function (ctx) { bridge = this; return subscribe.call(this, ctx) })
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'))
  const ctx = new Context()
  const logs = []
  const logger = t.mock.method(console, 'info', (...args) => logs.push(args.join(' ')))
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(Llm)
    await ctx.plugin(plugin, { baseURL: 'http://fixture.invalid', agentHint: { sessionControl: { pluginTriggers: false } } })
    const target = ctx.sessions.create(SessionId(session))
    bridge.noteOrdinaryRequest(session, 'fixture-model')
    bridge.onSessionArchived(session)
    await bridge.awaitPendingOp(session)
    const rows = logs.filter(row => row.startsWith('agent-hint/trace '))
      .map(row => JSON.parse(row.slice('agent-hint/trace '.length)))
      .filter(row => row.hint.session_control?.type === 'stop')
    // stdout keeps every phase of the attempt.
    assert.deepEqual(rows.map(row => row.phase), ['prepared', 'dispatch', 'result'])
    // The durable log keeps exactly the terminal record, and nothing else entered the surface.
    const events = target.snapshotEvents()
    const records = events.map(event => pluginRecordOf(event)).filter(Boolean)
    assert.equal(records.length, 1)
    assert.equal(records[0].type, plugin.HINT_TRACE_RECORD_TYPE)
    assert.equal(records[0].data.phase, 'result')
    assert.equal(records[0].data.outcome, 'accepted')
    assert.equal(records[0].data.requestId, rows[2].requestId)
    assert.equal(events.length, 1)
    assert.equal(target.surface.nodes.length, 0)
    assert.deepEqual(target.deriveMessages(), [])
  } finally { logger.mock.restore(); await ctx.fiber.dispose() }
})

test('writeToSession: false keeps stdout while the Session log stays untouched', async t => {
  let bridge
  const subscribe = LifecycleBridge.prototype.subscribe
  t.mock.method(LifecycleBridge.prototype, 'subscribe', function (ctx) { bridge = this; return subscribe.call(this, ctx) })
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'))
  const ctx = new Context()
  const logs = []
  const logger = t.mock.method(console, 'info', (...args) => logs.push(args.join(' ')))
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(Llm)
    await ctx.plugin(plugin, { baseURL: 'http://fixture.invalid', agentHint: {
      trace: { writeToSession: false }, sessionControl: { pluginTriggers: false } } })
    const target = ctx.sessions.create(SessionId(session))
    bridge.noteOrdinaryRequest(session, 'fixture-model')
    bridge.onSessionArchived(session)
    await bridge.awaitPendingOp(session)
    const rows = logs.filter(row => row.startsWith('agent-hint/trace '))
      .map(row => JSON.parse(row.slice('agent-hint/trace '.length)))
      .filter(row => row.hint.session_control?.type === 'stop')
    assert.deepEqual(rows.map(row => row.phase), ['prepared', 'dispatch', 'result'])
    assert.equal(target.snapshotEvents().length, 0)
  } finally { logger.mock.restore(); await ctx.fiber.dispose() }
})

test('a host without a Session store still traces to stdout only', async t => {
  let bridge
  const subscribe = LifecycleBridge.prototype.subscribe
  t.mock.method(LifecycleBridge.prototype, 'subscribe', function (ctx) { bridge = this; return subscribe.call(this, ctx) })
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'))
  const ctx = new Context()
  const logs = []
  const logger = t.mock.method(console, 'info', (...args) => logs.push(args.join(' ')))
  try {
    await ctx.plugin(Llm)
    await ctx.plugin(plugin, { baseURL: 'http://fixture.invalid', agentHint: { sessionControl: { pluginTriggers: false } } })
    bridge.noteOrdinaryRequest(session, 'fixture-model')
    bridge.onSessionArchived(session)
    await bridge.awaitPendingOp(session)
    const rows = logs.filter(row => row.startsWith('agent-hint/trace '))
      .map(row => JSON.parse(row.slice('agent-hint/trace '.length)))
      .filter(row => row.hint.session_control?.type === 'stop')
    assert.deepEqual(rows.map(row => row.phase), ['prepared', 'dispatch', 'result'])
  } finally { logger.mock.restore(); await ctx.fiber.dispose() }
})

test('real plugin wiring forwards lifecycle records to the server log', async t => {
  let bridge
  const subscribe = LifecycleBridge.prototype.subscribe
  t.mock.method(LifecycleBridge.prototype, 'subscribe', function (ctx) { bridge = this; return subscribe.call(this, ctx) })
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'))
  const ctx = new Context()
  const logs = []
  const logger = t.mock.method(console, 'info', (...args) => logs.push(args.join(' ')))
  try {
    await ctx.plugin(Llm)
    await ctx.plugin(plugin, { baseURL: 'http://fixture.invalid', agentHint: { sessionControl: { pluginTriggers: false } } })
    bridge.noteOrdinaryRequest(session, 'fixture-model')
    bridge.onSessionArchived(session)
    await bridge.awaitPendingOp(session)
    const rows = logs.filter(row => row.startsWith('agent-hint/trace ')).map(row => JSON.parse(row.slice('agent-hint/trace '.length)))
    assert.ok(rows.some(row => row.hint.session_control.type === 'stop' && row.outcome === 'accepted'))
  } finally { logger.mock.restore(); await ctx.fiber.dispose() }
})
