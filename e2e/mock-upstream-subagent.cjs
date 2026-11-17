// Mock OpenAI-compatible upstream that scripts a subagent delegation.
// Request #1 returns a `subagent` tool call; every later request returns text.
// One JSON line per request lands in captures.jsonl, including the agent_hint.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.join(__dirname, 'captures.jsonl')
const PORT = Number(process.env.MOCK_PORT || 9977)
fs.writeFileSync(OUT, '')
let n = 0

const sse = (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = null
    try { body = JSON.parse(raw) } catch { /* recorded raw below */ }
    n += 1
    const hasToolResult = JSON.stringify(body?.messages ?? '').includes('"tool"')
    fs.appendFileSync(OUT, JSON.stringify({
      at: new Date().toISOString(),
      seq: n,
      url: req.url,
      agent_hint: body?.agent_hint,
      sawToolResult: hasToolResult,
      messageRoles: (body?.messages ?? []).map((m) => m.role),
      systemHead: typeof body?.messages?.[0]?.content === 'string' ? body.messages[0].content.slice(0, 90) : null,
      body,
    }) + '\n')

    if (req.method !== 'POST') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return }

    const send = sse(res)

    // Only the first request delegates; the follow-up turn and the child's own
    // request both get a plain answer so the run terminates.
    if (n === 1 && !hasToolResult) {
      const args = JSON.stringify({ description: 'probe child', prompt: 'reply with pong' })
      send({ id: 'mock-1', object: 'chat.completion.chunk', created: 0, model: 'mock-model',
        choices: [{ index: 0, delta: { role: 'assistant', content: null,
          tool_calls: [{ index: 0, id: 'call_probe_1', type: 'function', function: { name: 'subagent', arguments: '' } }] } }] })
      send({ id: 'mock-1', object: 'chat.completion.chunk', created: 0, model: 'mock-model',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] })
      send({ id: 'mock-1', object: 'chat.completion.chunk', created: 0, model: 'mock-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    send({ id: `mock-${n}`, object: 'chat.completion.chunk', created: 0, model: 'mock-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'pong' }, finish_reason: null }] })
    send({ id: `mock-${n}`, object: 'chat.completion.chunk', created: 0, model: 'mock-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`mock upstream (subagent script) on http://127.0.0.1:${PORT}`))
