import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let ctx: Context | undefined
let server: ReturnType<typeof createServer> | undefined
afterEach(async () => {
  await ctx?.fiber.dispose(); ctx = undefined
  await new Promise<void>(resolve => server === undefined ? resolve() : server.close(() => resolve()))
  server = undefined
  vi.unstubAllEnvs()
})

describe('zero-model-config installation on stock rc.1', () => {
  it('extends the existing official provider, keeps its credentials/model, follows updates and unloads cleanly', async () => {
    vi.stubEnv('DSH_HOME', await mkdtemp(join(tmpdir(), 'dsh-hint-inherit-')))
    const received: { url: string; key: string | undefined; body: any }[] = []
    let rejectNext = false
    server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      received.push({ url: req.url!, key: req.headers['x-api-key'] as string | undefined, body })
      if (rejectNext) {
        rejectNext = false
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'fixture rejection', type: 'invalid_request_error' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const events = [
        { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
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
    await ctx.plugin(SessionStore)
    ctx.provide('credentials', { resolve: async (ref: string) => ({ value: `fixture-${ref}` }) } as never)
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(process.cwd() + '/').href })
    const rows = [
      { id: 'llm', name: '@deepseek-ai/dsh-llm' },
      { id: 'extensions', name: '@deepseek-ai/dsh-deepseek-llm-api-extensions' },
      { id: 'official', name: '@deepseek-ai/dsh-llm-deepseek-api-key', config: {
        baseURL, apiKeyEnv: 'A', models: [{ id: 'existing-model' }], thinking: 'disabled',
      } },
    ]
    await ctx.loader.root.update(rows); await ctx.loader.await()
    const originalProviders = ctx.llm.listProviders()
    const originalModels = await ctx.llm.listModels('deepseek-official')
    const run = async (id: string, purpose?: 'compaction' | 'session-title', failed = false) => {
      const chunks = []
      for await (const chunk of ctx!.llm.stream({
        provider: 'deepseek-official', model: 'existing-model', sessionId: SessionId(id),
        messages: [{ role: 'user', content: [{ type: 'text', text: 'unchanged user input' }] }],
        maxTokens: 8, signal: AbortSignal.timeout(3000), purpose,
      })) chunks.push(chunk)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: failed ? 'error' : 'stop' } })
      return received.at(-1)!
    }
    const session = ctx.sessions.create(SessionId('fresh'))
    const history = ctx.sessions.create(SessionId('historical'))
    const historyEvent = history.append('user/message', { id: MessageId('old-message'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'old input' }] }, { surfaceOp: 'append' })
    expect((await run('baseline')).body.agent_hint).toBeUndefined()
    const pluginRow = { id: 'hint', name: pathToFileURL(join(process.cwd(), 'lib/types/index.js')).href }
    // No baseURL, model list, credential, provider selection or default-model write.
    await ctx.loader.root.update([...rows, pluginRow]); await ctx.loader.await()
    expect(ctx.llm.listProviders()).toEqual(originalProviders)
    expect(await ctx.llm.listModels('deepseek-official')).toEqual(originalModels)
    expect((await run(history.id)).body.agent_hint).toEqual({ session_id: 'historical' })
    const fork = ctx.sessions.create(SessionId('forked'), { seed: [historyEvent], meta: { parentSession: history.id } })
    expect((await run(fork.id)).body.agent_hint).toEqual({ session_id: 'forked', parent_session_id: 'historical' })
    rejectNext = true
    const failed = await run(session.id, undefined, true)
    expect(failed.body.agent_hint).toEqual({ session_id: 'fresh', session_control: { type: 'start' } })
    const accepted = await run(session.id)
    expect(accepted.body.agent_hint).toEqual(failed.body.agent_hint)
    expect(accepted.key).toBe('fixture-A')
    expect(accepted.body.model).toBe('existing-model')
    expect(accepted.body.messages).toEqual(received[0].body.messages)
    expect((await run(session.id)).body.agent_hint).toEqual({ session_id: 'fresh' })
    for (const purpose of ['compaction', 'session-title'] as const) {
      expect((await run(session.id, purpose)).body.agent_hint).toBeUndefined()
    }
    expect((await run('unknown-session')).body.agent_hint).toEqual({ session_id: 'unknown-session' })
    const updatedRows = rows.map(row => row.id === 'official'
      ? { ...row, config: { ...row.config, baseURL: `${baseURL}/changed`, apiKeyEnv: 'B' } }
      : row)
    await ctx.loader.root.update([...updatedRows, pluginRow]); await ctx.loader.await()
    const changed = await run(session.id)
    expect(changed.url).toBe('/changed/v1/messages')
    expect(changed.key).toBe('fixture-B')
    expect(changed.body.agent_hint).toEqual({ session_id: 'fresh' })
    expect(received.every(r => r.url.endsWith('/v1/messages'))).toBe(true)
    await ctx.loader.root.update([...updatedRows, { ...pluginRow, config: { agentHint: { enabled: false } } }])
    await ctx.loader.await()
    expect((await run(session.id)).body.agent_hint).toBeUndefined()
    await ctx.loader.root.update([...updatedRows, pluginRow]); await ctx.loader.await()
    expect((await run(history.id)).body.agent_hint).toEqual({ session_id: 'historical' })
    ctx.loader.remove('hint'); await ctx.loader.await()
    expect((await run(session.id)).body.agent_hint).toBeUndefined()
    expect(ctx.llm.listProviders()).toEqual(originalProviders)
  }, 15000)

  it('ships an inherit-only installation patch with no server or model defaults', async () => {
    const patch = await readFile('cordis.patch.yml', 'utf8')
    expect(patch).toContain('mode: inherit')
    expect(patch).not.toMatch(/baseURL:|models:|provider:|agent-default-model/)
  })
})
