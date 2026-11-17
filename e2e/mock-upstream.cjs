// Mock OpenAI-compatible upstream that records exactly what the plugin sends.
// Listens on 127.0.0.1:9977 and appends one JSON line per request to captures.jsonl.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.join(__dirname, 'captures.jsonl')
const PORT = Number(process.env.MOCK_PORT || 9977)
fs.writeFileSync(OUT, '')

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = null
    try { body = JSON.parse(raw) } catch { /* keep raw below */ }
    fs.appendFileSync(OUT, JSON.stringify({
      at: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: {
        authorization: req.headers.authorization === undefined ? null : '<present>',
        'content-type': req.headers['content-type'] ?? null,
      },
      body: body === null ? { unparsed: raw.slice(0, 2000) } : body,
      // The two fields under test, lifted out so the assertion is unambiguous.
      agent_hint: body === null ? undefined : body.agent_hint,
    }) + '\n')

    if (req.method !== 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"data":[]}')
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
    send({ id: 'mock-1', object: 'chat.completion.chunk', created: 0, model: 'mock-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'pong' }, finish_reason: null }] })
    send({ id: 'mock-1', object: 'chat.completion.chunk', created: 0, model: 'mock-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    // Report an inflated prompt: DSH decides whether to compact from the usage the
    // backend reports, not from the configured window, so a mock that omits usage
    // can never trigger a compaction.
    if (body?.stream_options?.include_usage === true) {
      const used = Number(process.env.MOCK_PROMPT_TOKENS || 0)
      send({ id: 'mock-1', object: 'chat.completion.chunk', created: 0, model: 'mock-model',
        choices: [], usage: { prompt_tokens: used, completion_tokens: 8, total_tokens: used + 8 } })
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock upstream listening on http://127.0.0.1:${PORT}`)
})
