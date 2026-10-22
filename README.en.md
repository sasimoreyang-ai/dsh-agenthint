# DSH AgentHint

Adds a DeepSeek route carrying `agent_hint` to **DSH 0.2.0-rc.1**, so a MindIE-Motor coordinator receives session identity and lifecycle signals for external KV offload and prefetch.

**No engine change, no Motor change.** It works on a stock image.

Package: `@sasimoreyang-ai/dsh-llm-agent-hint` · [中文文档](README.md)

---

## Why it exists

External KV caching is per-session, so the engine must receive `agent_hint`. On a stock image the two entrypoints disagree:

| Entrypoint | Declares `agent_hint` | Consequence |
| --- | --- | --- |
| `/v1/messages` (Anthropic) | ❌ no — the request model drops unknown keys | Session never attaches; `pause`/`resume` silently no-op |
| `/v1/chat/completions` (OpenAI) | ✅ yes | Session attaches; blocks register |

DSH's own DeepSeek adapter speaks Messages. This plugin defaults to the chat/completions transport, so lifecycle control works on a stock engine. See [docs/transport.md](docs/transport.md).

---

## Install

```sh
dsh plugin --profile <your-profile> add 'github:sasimoreyang-ai/dsh-agenthint#v0.5.2'
```

Requires Node `^22.19.0 || >=24`, pnpm, and DSH **0.2.0-rc.1**. Built artifacts are committed, so installation needs no build step. Not published to the npm registry.

---

## One step after installing

**Point the default model at the plugin route.**

The plugin registers `deepseek-agent-hint`, while DSH ships `deepseek-official` as the default. Without switching, sessions keep using the old route and no hint is sent.

### Option A — pick it once in the UI

Restart DSH → model selector → **DeepSeek (agent-hint)** → new session.

### Option B — preset it at deployment (zero user action)

```yaml
- id: agent-default-model
  config:
    provider: deepseek-agent-hint
    model: DeepSeek-V4-Flash
```

Recommended for appliance images and bulk rollouts.

---

## No endpoint or model configuration

The plugin entry carries no address, model, or credential:

```yaml
- id: llm-agent-hint
  config: {}        # everything inherited
```

Endpoint and catalog resolve in this order:

| # | Source |
| --- | --- |
| 1 | Explicit plugin configuration |
| 2 | **Inherited from the `llm-deepseek` route** (its `baseURL` and `models`) |
| 3 | `DSH_AGENT_HINT_BASE_URL` |
| 4 | Built-in `http://127.0.0.1:1025` |

Rule 2 covers most deployments: an operator who can already reach a model has already named the endpoint. See [docs/endpoint-inheritance.md](docs/endpoint-inheritance.md).

---

## Transport

```yaml
- id: llm-agent-hint
  config:
    transport: chat        # default; works on a stock engine
    # transport: messages  # only when the engine already declares the field
```

| Transport | Data plane | Use when |
| --- | --- | --- |
| `chat` | `/v1/chat/completions` | **Stock engine (recommended)** |
| `messages` | `/v1/messages` | The engine supports the field natively |

Both transports share the same hint construction, lifecycle bridge and control plane. Control requests always go to `/v1/chat/completions`.

---

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
- Compaction and title-generation requests carry **no** hint; requests without a session identity carry none
- No model-visible prompt text is added

---

## Lifecycle control

| Verb | Trigger | Engine effect |
| --- | --- | --- |
| `start` | First ordinary request of a new session | Register session |
| `pause` | Switching away from a session | Offload |
| `resume` | Switching back | Prefetch |
| `compact` | After context compaction | Evict |
| `stop` | Session disposal or archive | Evict |

Every control action is **fail-open**: timeouts, transport errors and non-2xx responses only warn and never block the conversation.

---

## Measured results

Measured on node_153 (Ascend 910B3 × 8, MindIE-Motor, memcache) against the **stock image, no patch**.

### End-to-end TTFT (100K prefix, HBM under pressure)

| Scenario | TTFT |
| --- | --- |
| Cold (full prefill) | **25.74 s** |
| Connector on-demand load (no hint) | **2.35 s** |
| **Hint-driven prefetch** | **2.10 s** |

| Comparison | Reduction |
| --- | --- |
| **Hint increment** (prefetch vs on-demand) | **10.7%** |
| End-to-end (vs cold) | **91.9%** |

The prefetch takes about 1.03 s and is fully hidden by the user's typing interval.

### Control plane on the stock engine

```
offload  status=True  676–678 blocks
prefetch status=True  676–678 blocks
evict    status=True  676–678 blocks
```

No failures, no no-ops.

### ⚠️ Preconditions

| Condition | Note |
| --- | --- |
| **Long prefixes** | 10.7% at 100K; **near zero on a 26K session** |
| **HBM pressure** | Otherwise everything hits locally and prefetch is pointless |
| **Lead time** | Prefetch needs ~1.03 s; a shorter typing gap erodes the gain |

**Everyday short chats (a few K tokens) see no hint benefit.** That follows from the mechanism, not from configuration.

---

## Disable

```yaml
- id: llm-agent-hint
  config:
    agentHint:
      enabled: false
```

---

## Boundaries

- The plugin does not deploy models, configure memcache, or promise unconditional speedups
- The engine must accept `agent_hint`; services that reject unknown fields will fail the request
- Endpoint and catalog are inherited; **credentials are not**. Configure `apiKeyEnv` when the coordinator requires authentication
- Image, file and tool-declaration blocks are dropped by the chat transport rather than rejected
- Headless deployments lose only the browser draft observer

---

## Docs

| File | Contents |
| --- | --- |
| [docs/transport.md](docs/transport.md) | Why the default is chat/completions |
| [docs/endpoint-inheritance.md](docs/endpoint-inheritance.md) | Endpoint and catalog inheritance |
| [docs/path-b.md](docs/path-b.md) | Standalone control-plane implementation |
| [STANDARDIZATION.md](STANDARDIZATION.md) | Per-version implementation and verification records |
