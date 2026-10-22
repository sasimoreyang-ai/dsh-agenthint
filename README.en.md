# DSH AgentHint

Adds a **DeepSeek (agent-hint)** provider to **DSH 0.2.0-rc.1**, with session hints and lifecycle controls. No DSH core edits. [中文文档](README.md).

Current source: **0.6.0-rc.1 release candidate** on `codex/agenthint-v055-hardening`. No release tag/npm publication or node153 acceptance for this candidate yet.

## Install

```sh
dsh plugin --profile <your-profile> add 'github:sasimoreyang-ai/dsh-agenthint#codex/agenthint-v055-hardening'
```

For acceptance, pin an audited commit. Alternatively run `npm ci`, `npm run check`, `npm pack`, then install the resulting absolute tarball path with `dsh plugin --profile <your-profile> add <tarball>`.

Restart the relevant instance, select **DeepSeek (agent-hint)** and start a new session. Installation does not switch existing sessions. Requires Node `^22.19.0 || >=24`, pnpm and DSH **0.2.0-rc.1**. Built artifacts are included; this package is not published to npm registry.

## Configuration and protocols

An active `llm-deepseek` source supplies effective endpoint, models (including schema defaults), generation/transport settings and eligible credential references. Explicit settings win, including explicit localhost and `models: []`. Endpoint fallback is source → `DSH_AGENT_HINT_BASE_URL` → localhost:1025; absent models remain empty. Compatible Hint and lifecycle support is a backend requirement. `llm-pi-ai` is not inherited.

Credentials inherit only for the same full endpoint (trailing slash ignored), unless `inheritCredentials: false`. Inherited references use stock `x-api-key`; explicit `apiKeyEnv` retains Bearer behavior. Missing explicit credentials fail. Missing inherited references allow unauthenticated local coordinators; protected services can still return 401. Different control origins never receive model credentials. See [configuration inheritance](docs/endpoint-inheritance.md).

Default `transport: chat` uses `/v1/chat/completions` for both planes and preserves roles, tool-call/result IDs and reasoning history. Native images/files or unknown blocks fail explicitly; capability metadata is text-only. The host can project attachment handles to text. `transport: messages` retains the official adapter's attachment support and requires a backend that forwards Hint. See [transport](docs/transport.md).

## Lifecycle and recovery

Start rides the first ordinary request of a fresh session; bookkeeping commits after HTTP acceptance. Pause follows another session's accepted ordinary request once the previous agent is idle and its streams finish. Resume precedes a seeded/paused ordinary request or a qualifying empty-to-nonempty draft transition. Successful compaction emits compact; disposal/archive emits stop. UI navigation alone does not guarantee controls. Background purposes carry no Hint and do not change ordinary-session state.

Resume is advisory and may proceed after its bounded wait. Only explicit transient HTTP resume rejections retry; explicit failure can recover after a one-second cooldown. Mutations never retry automatically. Pending/unknown mutations block new same-session requests with `ControlBarrierError`. Full-stream leases cover direct and prepared dispatch. Unload cancels queued work/retries and active signals, but cannot recall backend requests.

Quarantine is in memory and does not survive reload/restart or coordinate multiple instances. Investigate the coordinator; use a new session ID to continue rather than treating restart as proof of completion. HTTP acceptance is not KV completion or backend fencing. See [reliability](docs/reliability.md).

`agentHint.sessionControl.enabled: false` keeps static identity hints without controls/start; `agentHint.enabled: false` disables all Hint/control behavior. Backend changes require draining requests and new sessions; catalog refresh does not migrate KV.

## Evidence

Local regression uses actual stock Loader, AgentLoop, Tools, TokenMeter and BasicCompaction with fixture model HTTP. It verifies a two-step tool task, pressure compaction and compact signaling, background isolation and configuration changes. See [validation record](STANDARDIZATION.md). It does not establish real KV, model quality or performance.

Historical v0.5.x repository measurements reported about 10.7% incremental TTFT improvement over passive cache loading under 100K-prefix/HBM pressure, n=4 per scenario. The 91.9% cold-baseline reduction includes cache infrastructure benefits. Those results do not certify this candidate or promise everyday-chat gains. The plugin does not deploy models or configure memcache.
