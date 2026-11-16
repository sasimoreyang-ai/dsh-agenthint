#!/usr/bin/env node
/**
 * Golden assertions for the headless end-to-end run.
 *
 * Reads the mock upstream's captures and the DSH Session log of the run, then
 * checks the Hint contract that actually matters: which requests carry a hint,
 * which must not, and what the terminal trace record looks like on disk.
 *
 * Usage: node verify-headless.cjs <captures.jsonl> <dsh-home> <session-id>
 */
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const [, , capturesPath, dshHome, sessionId] = process.argv
if (!capturesPath || !dshHome || !sessionId) {
  console.error('usage: verify-headless.cjs <captures.jsonl> <dsh-home> <session-id>')
  process.exit(2)
}

const failures = []
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  [${detail}]`}`)
  if (!ok) failures.push(label)
}

const captures = fs.readFileSync(capturesPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
check(captures.length >= 2, 'captured at least the ordinary and one background/control request', captures.length)

// Split by what the plugin should have put on the wire.
const hinted = captures.filter((r) => r.agent_hint !== undefined)
const hintless = captures.filter((r) => r.agent_hint === undefined)

// --- 1. Every hint names the live session and never a stale one.
for (const r of hinted) {
  check(r.agent_hint.session_id === sessionId, 'hint.session_id equals the running session', String(r.agent_hint.session_id))
}

// --- 2. A root session must not claim a parent; subagent lineage is a different field.
for (const r of hinted) {
  check(r.agent_hint.parent_session_id === undefined, 'root session carries no parent_session_id')
}

// --- 3. The ordinary request opens the session with `start`.
const starts = hinted.filter((r) => r.agent_hint.session_control?.type === 'start')
check(starts.length >= 1, 'the ordinary request carries session_control.type = start', starts.length)
for (const r of starts) {
  check(r.body?.stream === true, 'start rides the streaming chat request')
  check(Array.isArray(r.body?.messages) && r.body.messages.length > 0, 'start carries real messages')
}

// --- 4. Background work must not carry a hint. The title request is generated
//        automatically by the harness, so it is a free control case.
const titles = hintless.filter((r) => JSON.stringify(r.body?.messages ?? '').includes('Create a concise title'))
check(titles.length >= 1, 'a harness-generated title request happened in this run', titles.length)
for (const r of titles) {
  check(r.agent_hint === undefined, 'the title request carries no agent_hint')
}

// --- 5. Control verbs ride the same route but are non-streaming and hint-bearing.
const control = hinted.filter((r) => r.agent_hint.session_control !== undefined && r.agent_hint.session_control.type !== 'start')
for (const r of control) {
  check(r.body?.stream === false || r.body?.stream === undefined, `control ${r.agent_hint.session_control.type} is non-streaming`)
}

// --- 6. The terminal record is durable: exactly one per attempt, never the phases.
const logPath = execFileSync('find', [dshHome, '-name', 'session.v4.jsonl*'], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean)
  .find((p) => p.includes(sessionId))
if (logPath === undefined) {
  check(false, 'session log found for the run', dshHome)
} else {
  const raw = logPath.endsWith('.zstd')
    ? execFileSync('zstd', ['-dc', logPath], { encoding: 'utf8' })
    : fs.readFileSync(logPath, 'utf8')
  const events = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const records = events.filter((e) => e.type === 'plugin:mindagent-dsh-llm-agent-hint/trace')
  check(records.length === 1, 'exactly one terminal record reached the Session log', records.length)

  if (records.length > 0) {
    const d = records[0].data
    check(d.phase === 'result', 'the durable record is the terminal phase', d.phase)
    check(d.sessionId === sessionId, 'the durable record names the session', d.sessionId)
    check(d.schemaVersion === 1, 'the durable record carries schemaVersion 1', d.schemaVersion)
    check(d.hint.session_id === sessionId, 'the durable record repeats the wire hint', d.hint.session_id)
    check(records[0].ignorable === true, 'the record is marked ignorable so other readers skip it')
    check(d === undefined || records[0].surfaceOp === undefined, 'the record carries no surfaceOp (never model-visible)')
    // Content hygiene: the record must not smuggle prompts, keys or tool arguments.
    const asText = JSON.stringify(d)
    for (const secret of ['system', 'messages', 'Authorization', 'dummy-key']) {
      check(!asText.includes(secret), `the record does not contain "${secret}"`)
    }
  }

  // --- 7. The record must not disturb the turn: it sits between request context and the reply.
  const types = events.map((e) => e.type)
  check(types.includes('turn/start') && types.includes('turn/end'), 'the turn still opens and closes normally')
  check(types.includes('assistant/message'), 'the assistant reply is still recorded')
}

console.log('')
if (failures.length > 0) {
  console.error(`FAILED ${failures.length} check(s):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('ALL CHECKS PASSED')
