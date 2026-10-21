# DSH AgentHint

For **DSH 0.2.0-rc.1**. Install once to add `agent_hint` to existing DeepSeek Messages requests, without configuring another model, provider, endpoint or credential. [中文文档](README.md).

```sh
dsh plugin --profile web add 'github:sasimoreyang-ai/dsh-agenthint#v0.2.0'
```

Use your actual profile, restart DSH, and keep using the existing model. Requires Node `^22.19.0 || >=24`, pnpm and an already working DSH model connection. Built artifacts are included; the package is not published to the npm registry.

Default `mode: inherit` registers a field through the official `deepseekLlmApiExtensions` service. The existing adapter continues to own authentication, model selection and transport. Ordinary requests carry session identity, known fork lineage and a first-request `start` for known fresh sessions; acceptance is committed only after HTTP 2xx. Auxiliary compaction/title requests and anonymous requests are excluded. Existing sessions are hydrated on installation. Unloading removes the field registration.

Coverage is limited to adapters using that registry, including stock DeepSeek API-key/account adapters. OpenAI/Anthropic and other `llm-pi-ai` adapters are not covered. The endpoint must accept the field, and meaningful KV effects require coordinator/engine support. A missing model or credential is not supplied by this plugin.

Default mode does not emit independent pause/resume/compact/stop requests. The public extension callback exposes neither endpoint nor authentication nor provider, so guessing a control destination would be incorrect. Full lifecycle control remains available through `mode: standalone` and [examples/web.patch.yml](examples/web.patch.yml). Data requires `/v1/messages`; controls use `/v1/chat/completions`. Only session IDs, never draft content, are sent by the standalone browser observer.

**Migration from v0.1.0:** existing dedicated-route configurations must explicitly set `mode: standalone`. To use inherit mode, remove old dedicated-route overrides and use an already working host provider. The plugin does not rewrite saved/default model selections.

Standalone controls are serialized per session and ordinary requests wait for a bounded interval. A timeout remains an unknown engine outcome; ordering HTTP requests is not exactly-once execution. Disabling `agentHint.enabled` or unloading turns off Hint injection.

Validation: `npm ci && npm run check && npm pack`. Tests exercise published stock services and actual localhost HTTP; model responses and durable storage are fixtures. Hardware/performance and a live browser installation require separate validation. See [design and investigation](docs/zero-config.md), [verification records](STANDARDIZATION.md) and [standalone implementation](docs/path-b.md).

MIT; attribution in [NOTICE](NOTICE).
