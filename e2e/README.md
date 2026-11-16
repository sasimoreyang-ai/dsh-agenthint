# Headless end-to-end verification

Proves — without a GPU, an engine, or a gateway — that the plugin emits the Hint
signal on the wire and that the terminal record reaches the DSH Session log.

The trick is a local mock upstream: point `baseURL` at it and it records the
exact request bodies the plugin sends. That is stronger evidence than a real
engine, because the assertion runs against a copy of the bytes that left the
process.

## What it does and does not cover

| Covered | Not covered |
|---|---|
| `agent_hint` shape and presence on the ordinary request | KV reuse or any speedup (needs a real engine) |
| `agent_hint` **absent** on harness-generated background work | `resume` (needs a browser composer draft) |
| `session_control.type = start` and `stop` | `pause` (needs two live sessions) |
| Terminal-only trace record in `session.v4.jsonl` | `compact` (needs a compaction) |
| Record hygiene: no prompts, keys or tool arguments | Gateway transparency (needs the real gateway) |
| The turn still opens, closes and records the reply | Browser UI |

The three verbs that a one-shot headless run cannot produce are exactly the
three that depend on UI or a second session; the unit suite covers their state
machine, and `docs/trace.md` documents the triggers.

## Run it

Prerequisites on the host: `node >= 24.9` (DSH requires it), `pnpm` on `PATH`,
and a scratch `DSH_HOME` you do not mind creating.

```bash
export DSH_HOME=/root/hint-e2e/home
export MODEL_API_KEY=dummy-key-for-mock      # the mock accepts any value
export DEEPSEEK_API_KEY=dummy-unused         # the stock deepseek route demands one at boot
export PATH=/opt/node-v24.9.0/bin:$PATH

# 1. Install DSH and this plugin into separate scopes.
mkdir -p /root/hint-e2e/dsh && cd /root/hint-e2e/dsh
npm init -y && npm i @deepseek-ai/dsh@0.2.2-rc.1
npm pack --ignore-scripts --pack-destination /root/hint-e2e <plugin-repo>
npm i /root/hint-e2e/*.tgz
./node_modules/.bin/dsh plugin --profile headless add file:/root/hint-e2e/*.tgz

# 2. Boot once so the profile skeleton exists (it exits on the missing credential).
./node_modules/.bin/dsh --profile headless "say hi" || true

# 3. Point the plugin at the mock, then run one turn.
node e2e/mock-upstream.cjs &
cat > "$DSH_HOME/settings.yaml" <<'YAML'
llm-agent-hint:
  baseURL: http://127.0.0.1:9977
  apiKeyEnv: MODEL_API_KEY
  models:
    - id: mock-model
      name: Mock Model (AgentHint)
      contextWindow: 8192
      maxTokens: 256
agent-default-model:
  provider: deepseek-agent-hint
  model: mock-model
YAML
./node_modules/.bin/dsh --profile headless "reply with pong"

# 4. Assert.
SID=$(ls "$DSH_HOME/sessions"/*/ | grep -oE 'session-[0-9a-f-]+' | head -1)
node e2e/verify-headless.cjs captures.jsonl "$DSH_HOME" "$SID"
```

`verify-headless.cjs` exits non-zero and names every failed check.

## What a passing run shows

```
agent_hint: {"session_id":"session-…","session_control":{"type":"start"}}   ← ordinary request
agent_hint: undefined                                                      ← title request, by design
agent_hint: {"session_id":"session-…","session_control":{"type":"stop"}}   ← control request
```

and one `plugin:mindagent-dsh-llm-agent-hint/trace` event in the Session log
carrying `phase: "result"`, `ignorable: true` and no `surfaceOp`.

## Two behaviours worth knowing

**The control request sends `messages: []`.** This repository does not implement
the platform's `padControlMessages` option; it sends an empty array and relies on
the coordinator accepting a control verb without messages. A backend that
validates messages as non-empty will reject control calls — set the platform
option or pad here before pointing at such a backend.

**A control verb issued during process exit may not reach the Session log.** The
mock sees the `stop` request and stdout logs its trace, but the durable write can
lose the race against the session closing. The ordinary request's record is
unaffected. Do not read a missing `stop` record as a missing signal: check stdout
first.
