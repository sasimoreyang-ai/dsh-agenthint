# DSH AgentHint

给 **DSH 0.2.0-rc.1 已有的 DeepSeek Messages 模型请求**自动添加 `agent_hint`。默认安装后继续使用原模型，无需为插件再填写地址、API Key、模型列表或修改默认模型。无需修改 DSH 核心。

包名：`@sasimoreyang-ai/dsh-llm-agent-hint`。[English](README.en.md)

## 安装后怎么用

```sh
dsh plugin --profile web add 'github:sasimoreyang-ai/dsh-agenthint#v0.2.0'
```

安装到你实际使用的 profile，重新启动该 DSH 实例，然后照常聊天。**不需要添加 AgentHint 服务商，不需要运行额外的模型配置 patch，也不需要切换模型。** 原有会话也会接入；已有历史不会被当作新会话重新发送 `start`。

需要 Node.js `^22.19.0 || >=24`、pnpm 和 DSH **0.2.0-rc.1**。Git 包含构建产物，安装无需编译 DSH。本包未发布到 npm registry，不使用裸 npm 包名安装。

前提是 DSH 原本就能调用一个模型。如果原有模型缺 API Key、服务器地址或网络不通，插件无法代替模型服务的首次接入。无需重复配置模型，不代表能凭空获得一个可用模型。

## 默认模式会发送什么

默认 `mode: inherit` 使用 DSH 的公开 `deepseekLlmApiExtensions` 注册表，保持现有适配器负责地址、认证、模型选择、请求构建和响应处理。

```json
{
  "model": "原来选择的模型",
  "messages": ["原来的消息内容"],
  "agent_hint": { "session_id": "当前会话 ID" }
}
```

上面仅示意新增字段位置，messages 使用原适配器的真实格式。已知新会话首次普通请求附带 `session_control: {"type":"start"}`，HTTP 2xx 后才记账；已知 fork 附带 `parent_session_id`。压缩、标题生成等辅助请求不带 Hint，无 session ID 的请求也不带 Hint。插件不添加模型可见提示词。

**支持边界：** 默认覆盖调用该官方扩展注册表的 DeepSeek Messages 适配器，包括 rc.1 的官方 API-key/account 适配器。`llm-pi-ai` 的 OpenAI、Anthropic 等其他协议适配器不调用此接口，本版本不承诺为它们注入 Hint。上游服务也必须接受扩展字段；服务可能拒绝未知字段，插件不会捕获这类错误后偷偷重放请求。

**发送 Hint ≠ 引擎执行 KV 优化。** 协调器与引擎需要实现对应能力。插件不部署模型，不配置 memcache/Mooncake，不承诺性能收益。

## 两种模式

| 能力 | inherit：默认安装 | standalone：独立协调器 |
| --- | --- | --- |
| 复用原模型、地址、认证 | 是，不创建 provider | 单独配置 provider |
| 普通请求会话身份、fork 信息、首次 start | 是 | 是 |
| 独立 pause / resume / compact / stop 请求 | 不发送 | 支持 |
| 草稿通知与归档观察 | 不启用 | 启用，可关闭 |
| 用户需要重新配置模型 | 不需要 | 需要配置协调器路由 |

官方扩展回调只给请求体、sessionId、purpose 和 signal，**没有请求目标 URL、认证头或 provider**。因此默认模式不猜测控制服务地址、不读取其他 provider 的私有状态、不向默认 localhost 或未知服务器发送管理请求。要自动复用连接并发出全部独立控制信号，还需要宿主增加公开的请求连接上下文接口。

## 已使用 v0.1.0 的用户

v0.2.0 默认方式改变。若之前写过 `llm-agent-hint` 的地址/模型 patch，并希望继续使用独立控制功能，在该条目的 config 加 `mode: standalone`；其余配置沿用。若要改成默认复用模式，移除旧 AgentHint 路由覆盖，并使用 DSH 原有可用 provider。插件不会擅自改写既有会话或默认模型指向。

只想关闭默认 Hint 时，可将插件配置的 `agentHint.enabled` 设为 `false`，或卸载插件。卸载会撤销注册，不改已有模型配置。

## 独立协调器模式（高级用法）

仅需要完整生命周期控制时使用 [examples/web.patch.yml](examples/web.patch.yml)。配置示例：

```yaml
- id: llm-agent-hint
  config:
    mode: standalone
    provider: deepseek-agent-hint
    baseURL: http://YOUR_COORDINATOR:1025
    # apiKeyEnv: MOTOR_API_KEY
    models:
      - id: YOUR_SERVED_MODEL
    agentHint:
      enabled: true
      sessionControl:
        enabled: true
        pluginTriggers: true
        pendingOpAwaitMs: 2000
        controlTimeoutMs: 5000
        retries: 1
```

数据面要求 `/v1/messages`；独立控制面默认使用同地址的 `/v1/chat/completions`。此模式需选择 `deepseek-agent-hint` 路由。地址、模型、凭据必须来自实际部署；示例不能直接连接你的服务器。不要同时安装占用同一字段或同一 provider 的原版 AgentHint 插件。

- `pause`：前台切到其他会话后，旧会话空闲时发送。
- `resume`：历史/暂停会话开始输入时发送，普通请求前提供兜底。
- `compact`：已使用本路由的会话完成压缩时发送。
- `stop`：归档或销毁时发送。

同一会话的控制 HTTP 操作按顺序执行，普通请求只进行有上限的等待。超时后仍可能存在未完成的引擎操作；串行客户端请求不等于引擎 exactly-once 或物理 KV 完成。失败为 advisory，默认一次重试。浏览器只发送 session ID，不上传草稿正文。

## 开发与验证

```sh
npm ci
npm run check
npm pack
```

测试使用公开 rc.1 Loader、官方 API-key 适配器、扩展注册表、Session、Gateway 和 WorkspaceRegistry，并捕获 localhost 的真实 HTTP 请求；外部模型响应与存储介质为测试替身。覆盖默认无模型配置加载、凭据与地址更新、历史/fork、失败后 start 重试、辅助请求排除、禁用/卸载、独立控制队列和归档并发。

源码改变后须提交同步生成的 `lib`，确保 GitHub 直接安装有效。CI 检查编译、测试、打包和构建产物一致性。

[开箱即用设计与补充文档问题答复](docs/zero-config.md) · [验证记录](STANDARDIZATION.md) · [独立模式路径 B](docs/path-b.md)

## 许可

[MIT](LICENSE)。上游与改动归属见 [NOTICE](NOTICE)。
