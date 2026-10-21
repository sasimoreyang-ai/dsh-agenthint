# DSH AgentHint

Standalone community AgentHint provider for **DSH 0.2.0-rc.1**. Package: `@sasimoreyang-ai/dsh-llm-agent-hint`. [完整中文文档](README.md).

Install: `dsh plugin --profile web add 'github:sasimoreyang-ai/dsh-agenthint#v0.1.0'`. Built host/browser artifacts are included. Configure [examples/web.patch.yml](examples/web.patch.yml), run `dsh web --patch /absolute/path/web.patch.yml`, select the provider and create a new session. Requires stock DSH rc.1, Node `^22.19.0 || >=24`, pnpm and a Messages-capable coordinator. This package is not published on the npm registry.

Data uses `/v1/messages`; advisory controls use `/v1/chat/completions`. Composer transitions use the existing authenticated Connection, a plugin Remote Service and a public Slot. Only session ID crosses the browser/host boundary; draft text stays local. Successful public archive operations use reversible runtime observers. No core files or official packages are patched.

Signals: accepted first request `start`, foreground/idle `pause`, empty-to-nonempty composer `resume`, successful `compact`, archive/disposal `stop`. Ordinary requests also provide resume fallback. Deduplication does not imply exactly-once HTTP delivery; configured retries may make another attempt. Failures do not break ordinary requests. HTTP acceptance does not prove physical KV completion or performance gains.

Development: `npm ci`, `npx tsc -b --force`, `npm test`, `npm pack`. Tests use stock published Loader, Gateway, Session and WorkspaceRegistry implementations plus localhost HTTP capture. Model responses and external durable media are test doubles. See [docs/path-b.md](docs/path-b.md) and [STANDARDIZATION.md](STANDARDIZATION.md) for evidence and limits.

The plugin uses public DeepSeekAdapter registration because rc.1's helper overwrites a passed prepareExtensions callback. Host and Client compile separately. Built lib files are committed for Git installation. This task does not deploy inference services or switch KV backends. MIT; attribution in [NOTICE](NOTICE).
