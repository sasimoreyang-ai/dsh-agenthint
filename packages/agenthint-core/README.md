# @sasimoreyang-ai/agenthint-core

Host-neutral core for the AgentHint protocol: wire types, the pure hint
builder, the per-session control queue and barriers, the error vocabulary, and
the control transport contract.

It imports **nothing** from any agent framework, UI toolkit or cloud SDK. A host
adapter supplies session identity, request classification, credentials and a
transport; this package supplies the rules that keep cache mutations from racing
inference.

## Install

```bash
npm install @sasimoreyang-ai/agenthint-core
```

No peer dependencies. Node 20+.

## What it does not do

- It does not talk to a model. Request transport stays in the host adapter.
- It does not read host configuration, credentials or session stores.
- It does not decide *when* the foreground moved away — that policy belongs to
  the adapter, because it is meaningful only inside one host's interaction
  model.
- It does not prove that a backend finished a cache action. HTTP acceptance is
  not KV completion.

## Minimal use

```ts
import { HintCoordinator } from '@sasimoreyang-ai/agenthint-core'
import { HttpControlTransport } from '@sasimoreyang-ai/agenthint-core/http'

const coordinator = new HintCoordinator({
  transport: new HttpControlTransport({
    endpoint: 'http://coordinator.example/v1/chat/completions',
    resolveApiKey: async () => process.env.COORDINATOR_KEY,
    defaultModel: 'DeepSeek-V4-Flash',
  }),
})

// The host tells the core what it knows.
coordinator.registerSession({ sessionId: 'session-1', seeded: false })

// The host prepares each ordinary model call.
const lease = await coordinator.prepareRequest({
  sessionId: 'session-1',
  requestClass: 'ordinary',
  model: 'DeepSeek-V4-Flash',
})

const body = { model: 'DeepSeek-V4-Flash', messages, ...lease.hint === undefined ? {} : { agent_hint: lease.hint } }
try {
  const response = await send(body)
  lease.accepted()          // only after the endpoint accepted the request
  await consume(response)
} finally {
  lease.finish()            // always: completion, error, cancellation
}

// The host asks for lifecycle actions; the core decides when they are safe.
await coordinator.requestControl({ verb: 'pause', sessionId: 'session-1', model: 'DeepSeek-V4-Flash' })
```

## The rules that matter

| Rule | Why |
|---|---|
| `start` rides the first ordinary request only, and only after acceptance | A rejected request must not consume the session's single `start` |
| Background calls never carry a hint | A title or summary call must not perturb the live session's cache identity |
| A mutating verb is never retried | A timeout or 5xx may already have executed; resending can duplicate a cache action |
| An unknown mutation quarantines the session | The next ordinary request raises `CONTROL_BARRIER`, which must not be downgraded into a retryable transport error |
| The stream lease covers the whole stream | `pause`/`stop` must not overtake in-flight inference |
| One coordinator per trust scope | Sharing one instance across users would let one user's traffic pause another's session |

## Errors

`AgentHintError` carries a stable `code`:

| Code | Meaning |
|---|---|
| `CONTROL_BARRIER` | A cache-changing control is pending or has an unknown outcome |
| `INVALID_INPUT` | The supplied facts cannot produce a valid hint |
| `DISPOSED` | The coordinator no longer accepts work |

Adapters map the code onto their own error type. Never map `CONTROL_BARRIER`
onto a retryable transport failure.

## Optional HTTP transport

`@sasimoreyang-ai/agenthint-core/http` implements the current coordinator
protocol: an empty-messages chat-completions request carrying
`agent_hint.session_control`. Import it only if your backend speaks that
protocol; the coordinator itself only needs the `ControlTransport` interface.

## License

Apache-2.0
