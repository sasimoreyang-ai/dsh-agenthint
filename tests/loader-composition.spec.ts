import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let ctx: Context | undefined
let server: ReturnType<typeof createServer> | undefined
afterEach(async () => {
  await ctx?.fiber.dispose(); ctx = undefined
  await new Promise<void>(resolve => server === undefined ? resolve() : server.close(() => resolve()))
  server = undefined; vi.unstubAllEnvs()
})

describe('built plugin on stock rc.1 Loader and services', () => {
  it('sends start/pause/resume/compact/stop through real transports without core events', async () => {
    vi.stubEnv('DSH_HOME', await mkdtemp(join(tmpdir(), 'dsh-agenthint-test-')))
    const requests: { path: string; key?: string; body: Record<string, any> }[] = []
    server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push({ path: req.url!, key: req.headers.authorization, body })
      if (req.url?.endsWith('/v1/chat/completions')) {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const events = [
        { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture', content: [], usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
      res.end(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()!
    if (typeof address === 'string') throw new Error('Expected TCP listener')
    const baseURL = `http://127.0.0.1:${address.port}`
    ctx = new Context()
    ctx.provide('credentials', { resolve: async (ref: string) => ({ value: `fixture-${ref}` }) } as never)
    await ctx.plugin(SessionStore)
    // The external durable medium is controlled; archive logic and its Cordis
    // service receiver are the actual published WorkspaceRegistry implementation.
    let durable = { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] }
    ctx.provide('storageDomain', {
      open: async () => ({ table: () => new Map(), close: async () => {},
        global: { get: () => durable, set: async (next: typeof durable) => { durable = next } } }),
    } as never)
    ctx.provide('sessionPersistence', { list: async () => [] } as never)
    await ctx.plugin(WorkspaceRegistry)
    const originalArchive = Object.getPrototypeOf(ctx.workspaceRegistry).archiveSession
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(process.cwd() + '/').href })
    const loader = ctx.loader
    const entries = [
      { id: 'llm', name: '@deepseek-ai/dsh-llm' },
      { id: 'hint', name: pathToFileURL(join(process.cwd(), 'lib/types/index.js')).href,
        config: { mode: 'standalone', baseURL, apiKeyEnv: 'A', models: [{ id: 'fixture' }], thinking: 'disabled',
          agentHint: { sessionControl: { retries: 0 } } } },
    ]
    await loader.root.update(entries)
    await loader.await()
    expect(ctx.llm.listProviders().some(p => p.id === 'deepseek-agent-hint')).toBe(true)
    const a = ctx.sessions.create(SessionId('fixture-a'))
    const b = ctx.sessions.create(SessionId('fixture-b'))
    const run = async (id: SessionId, purpose?: 'compaction') => {
      const output = []
      for await (const chunk of ctx!.llm.stream({
        provider: 'deepseek-agent-hint', model: 'fixture', sessionId: id,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture input' }] }],
        signal: AbortSignal.timeout(3000), maxTokens: 8, purpose,
      })) output.push(chunk)
      expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    }
    await run(a.id)
    await run(b.id)
    await vi.waitFor(() => expect(requests.some(r => r.body.agent_hint?.session_control?.type === 'pause')).toBe(true))
    await ctx.typertGateway.invoke({ namespace: 'agentHintSignals', method: 'composing', args: { request: { sessionId: a.id } } })
    await run(a.id)
    await run(a.id, 'compaction')
    ctx.emit('session/event', a, { type: 'compaction/end', data: { compactionId: 'fixture-c', turn: 1 }, time: 1, seq: 1 } as never)
    await vi.waitFor(() => expect(requests.some(r => r.body.agent_hint?.session_control?.type === 'compact')).toBe(true))
    await ctx.workspaceRegistry.archiveSession(a.id)
    expect(durable.archivedSessionIds).toContain(a.id)
    await vi.waitFor(() => expect(requests.some(r => r.body.agent_hint?.session_id === a.id && r.body.agent_hint?.session_control?.type === 'stop')).toBe(true))
    const data = requests.filter(r => r.path === '/v1/messages')
    expect(data[0].body.agent_hint).toEqual({ session_id: a.id, session_control: { type: 'start' } })
    expect(data[2].body.agent_hint).toEqual({ session_id: a.id })
    expect(data[3].body.agent_hint).toBeUndefined()
    const controls = requests.filter(r => r.path === '/v1/chat/completions')
    expect(controls.filter(r => r.body.agent_hint.session_control.type === 'resume')).toHaveLength(1)
    expect(controls.every(r => r.body.messages.length === 0)).toBe(true)
    // Public registry operations queued concurrently must preserve both transitions.
    await ctx.workspaceRegistry.unarchiveSession(a.id)
    await Promise.all([ctx.workspaceRegistry.archiveSession(a.id), ctx.workspaceRegistry.unarchiveSession(a.id)])
    expect(ctx.workspaceRegistry.archivedSessionIds).not.toContain(a.id)
    const resumesBefore = requests.filter(r => r.body.agent_hint?.session_control?.type === 'resume').length
    await ctx.typertGateway.invoke({ namespace: 'agentHintSignals', method: 'composing', args: { request: { sessionId: a.id } } })
    await vi.waitFor(() => expect(requests.filter(r => r.body.agent_hint?.session_control?.type === 'resume').length).toBe(resumesBefore + 1))
    // Volatile connection changes must keep endpoint and credential together.
    const updated = entries.map(entry => entry.id === 'hint'
      ? { ...entry, config: { ...entry.config, baseURL: `${baseURL}/changed`, apiKeyEnv: 'B' } }
      : entry)
    await loader.root.update(updated); await loader.await()
    await run(a.id)
    ctx.emit('session/event', a, { type: 'compaction/end', data: { compactionId: 'fixture-d', turn: 2 }, time: 2, seq: 2 } as never)
    await vi.waitFor(() => expect(requests.some(r => r.path === '/changed/v1/chat/completions'
      && r.key === 'Bearer fixture-B' && r.body.agent_hint?.session_control?.type === 'compact')).toBe(true))
    expect(requests.some(r => !r.path.startsWith('/changed/') && r.key === 'Bearer fixture-B')).toBe(false)
    loader.remove('hint'); await loader.await()
    await vi.waitFor(() => expect(ctx!.get('agentHintSignals')).toBeUndefined())
    expect(Object.hasOwn(ctx.workspaceRegistry, 'archiveSession')).toBe(false)
    expect(Object.getPrototypeOf(ctx.workspaceRegistry).archiveSession).toBe(originalArchive)
    expect(ctx.llm.listProviders().some(p => p.id === 'deepseek-agent-hint')).toBe(false)
  }, 15000)
})
