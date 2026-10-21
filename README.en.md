# DSH AgentHint

Adds a DeepSeek Messages route carrying `agent_hint` to **DSH 0.2.0-rc.1**, so a MindIE-Motor coordinator receives session identity and lifecycle signals for external KV offload and prefetch. No DSH core changes. [中文文档](README.md).

Package: `@sasimoreyang-ai/dsh-llm-agent-hint`.

## Install

```sh
dsh plugin --profile <your-profile> add 'github:sasimoreyang-ai/dsh-agenthint#v0.4.0'
```

Restart that DSH instance, pick **DeepSeek (agent-hint)** in the model list, and start a new session.

Requires Node `^22.19.0 || >=24`, pnpm, and DSH **0.2.0-rc.1**. Built artifacts are committed, so installation needs no build step. Not published to the npm registry.

## No endpoint or model configuration

The bundle's `cordis.patch.yml` contains no address, model, or credential. Endpoint and catalog resolve in this order:

| # | Source | Notes |
| --- | --- | --- |
| 1 | Explicit plugin configuration | Honoured when present |
| 2 | **Inherited from the `llm-deepseek` route** | Reads the operator's existing `baseURL` and `models` |
| 3 | `DSH_AGENT_HINT_BASE_URL` | For scripted deployments |
| 4 | Built-in `http://127.0.0.1:1025` | Co-located fallback |

Rule 2 covers most deployments: an operator who can already reach a model has already named the endpoint, so the plugin reuses it instead of asking again. See [docs/endpoint-inheritance.md](docs/endpoint-inheritance.md).

## What is sent

```json
{
  "model": "DeepSeek-V4-Flash",
  "messages": ["..."],
  "agent_hint": {
    "session_id": "current session id",
    "parent_session_id": "fork lineage, when known",
    "cache_control": { "type": "..." },
    "session_control": { "type": "start" }
  }
}
```

- `session_control` appears only at specific moments: the first ordinary request of a new session carries `start`
- `pause`, `resume`, `stop`, `compact` are separate manage requests to `<baseURL>/v1/chat/completions`
- Compaction and title-generation requests carry no hint; requests without a session identity carry none
- No model-visible prompt text is added

## Lifecycle control

| Verb | Trigger | Engine effect |
| --- | --- | --- |
| `start` | First ordinary request of a new session | Register session |
| `pause` | Switching away from a session | Offload |
| `resume` | Switching back | Prefetch |
| `compact` | After context compaction | Evict |
| `stop` | Session disposal or archive | Evict |

Every control action is fail-open: timeouts, transport errors and non-2xx responses only warn and never block the conversation.

## Disable

```yaml
- id: llm-agent-hint
  config:
    agentHint:
      enabled: false
```

Uninstalling also withdraws the registration and leaves existing model configuration untouched.

## Verification status

Measured on node_153 (Ascend 910B3 × 8 with a MindIE-Motor coordinator):

| Item | Result |
| --- | --- |
| Install and auto-composition | ✅ |
| Endpoint and catalog inheritance | ✅ zero-config plugin entry, request succeeds |
| All five verbs triggered | ✅ `start` 22, `pause` 18, `resume` 11, `stop` 11, `compact` 1 |
| Engine executed all actions | ✅ offload / prefetch / evict, 4,917 blocks each |

**Known engine-side limitation**: on the tested coordinator, `/v1/messages` does not register block records with the session-aware manager, while `/v1/chat/completions` does. DSH's DeepSeek adapter speaks the Messages protocol, so requests issued through DSH currently find no blocks to offload.

Seeding the same session through `/v1/chat/completions` makes all four actions succeed immediately:

```
offload  status=True  actual_op_block_num 4917
prefetch status=True  actual_op_block_num 4917
evict    status=True  actual_op_block_num 4917
```

This belongs to the coordinator/engine and cannot be worked around inside the plugin.

## Boundaries

- The plugin does not deploy models, configure memcache/Mooncake, or promise performance gains
- The engine must accept the `agent_hint` field; services that reject unknown fields will fail the request
- Endpoint and catalog are inherited; **credentials are not**. Configure `apiKeyEnv` when the coordinator requires authentication
- Only DeepSeek Messages routes are supported; `llm-pi-ai` OpenAI/Anthropic adapters are out of scope
- Headless deployments lose only the browser draft observer; everything else works
