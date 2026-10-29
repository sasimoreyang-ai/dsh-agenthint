# DSH AgentHint

为 **DSH 0.2.0-rc.2** 增加 **DeepSeek (agent-hint)** 路由。普通请求携带会话 Hint，生命周期事件向兼容协调器发送控制请求。无需修改 DSH 核心。[English](README.en.md)

当前代码：**0.6.0-rc.5 发行候选**，基于未拆分 main。修复依赖锁定、缺测 usage 补零及已有草稿编辑的恢复通知，并统一实际触发合同。尚未发布此版本 tag 或 npm 包；本候选的153实机/KV/性能验收尚未执行。

## 安装

从本修复分支安装（交付后可用；生产验收应固定到审核通过的 commit）：

```sh
dsh plugin --profile <你的profile> add 'github:sasimoreyang-ai/dsh-agenthint#fix/main-release-correctness-20261029'
```

也可以在源码目录 `npm ci && npm run check && npm pack`，再安装生成的 tarball：

```sh
dsh plugin --profile <你的profile> add /绝对路径/sasimoreyang-ai-dsh-llm-agent-hint-0.6.0-rc.5.tgz
```

重启相应 DSH 实例，选择 **DeepSeek (agent-hint)** 并新建会话。插件不会自动切换已有会话的 provider。需要 Node `^22.19.0 || >=24`、pnpm 与 DSH **0.2.0-rc.2**。包内已包含构建产物；本包未发布 npm registry。

## 什么时候无需重复配置

如果已有活动的 **`llm-deepseek`** 源路由，且其后端支持选定协议的 `agent_hint` 与 session-control，插件可复用实际端点、模型目录、生成设置和适用的凭据引用。

| 设置 | 优先级 |
| --- | --- |
| 地址 | 插件显式值 → 活动源路由 → `DSH_AGENT_HINT_BASE_URL` → localhost:1025 |
| 模型目录 | 插件显式目录（包括空数组）→ 源实际目录（包括官方默认值）→ 空 |
| 生成/传输参数 | 插件显式值 → 源实际值 → 官方协议默认值 |
| 凭据 | 插件显式 `apiKeyEnv` → 同一完整端点的源引用（可关闭） |

无活动来源且未指定模型时，插件不会猜测模型。`llm-pi-ai` 不在继承范围内。通用 DeepSeek/OpenAI 服务不一定接受 Hint 字段；“原模型可用”不自动证明其支持 KV 控制。详见 [配置继承](docs/endpoint-inheritance.md)。

## 协议与内容

默认 `transport: chat`，数据与控制均走 `/v1/chat/completions`，兼容已有 `/v1` 根地址。`transport: messages` 保留官方 Messages 适配器，要求后端 Messages 入口声明并转发 Hint。

Chat 保留 system/developer/user/assistant/tool 角色、工具调用ID与结果、reasoning历史，使用完整当前工具声明。原生图片/文件或未知内容块明确报 `UNSUPPORTED_CONTENT`，不再静默丢弃；模型能力声明为文本。真实宿主可能先把附件投影成可读的文本句柄。Messages 的附件能力由官方适配器提供。详见 [传输合同](docs/transport.md)。

## 实际信号

普通请求的 `agent_hint` 包含 `session_id`、已知时的 `parent_session_id`，以及显式设置的 `cache_control`。辅助 `purpose` 请求和匿名请求不带 Hint；插件不添加任务提示词。

| 信号 | 触发条件 | 意图 |
| --- | --- | --- |
| start | 新会话首个普通请求，HTTP接受后提交记账 | 登记 |
| pause | 另一会话普通请求被接受，前一会话空闲且其在途流结束 | 请求卸载 |
| resume | 有历史/已暂停会话的普通请求前，或当前会话首次观察到非空草稿编辑 | 请求预取 |
| compact | 已使用路由的会话成功完成上下文压缩 | 请求驱逐 |
| stop | 会话销毁或成功归档 | 请求驱逐 |

浏览器公共输入组件挂载或切换会话时仅记录基线，不发送通知。随后首次观察到非空文本变化时，通过 `composing` 请求恢复；包括已有草稿的继续编辑和同长度替换，持续编辑不重复通知，清空后可以重新通知。桥接器只对已知且符合恢复条件的会话发送 resume。

宿主公开状态没有编辑来源标记，因此“切页同帧粘贴”与“恢复旧草稿”无法可靠区分；首次挂载前已有的文本也只作基线。这些情况若没有后续编辑，在发送普通请求时兜底恢复，不保证输入阶段的提前量。旧 `activated` RPC 仅为兼容保留，当前客户端不调用。单纯切页不触发 pause，pause 仍以其他会话的普通请求被接受为条件。HTTP 2xx 只代表HTTP接受，不能证明实际KV动作完成。

Chat 缺失或不完整的 usage 不补零；只发布完整有效的计量样本，并拒绝矛盾计数。没有 usage 时正文可以正常完成，用量保持未知。详见[传输合同](docs/transport.md)。

## 故障策略

- resume 是 advisory：默认等待2秒后可继续普通推理。只重试明确的 HTTP 408/429/5xx，默认一次；明确失败后经过1秒冷却可以再次触发。
- pause/compact/stop 不自动重试。同会话完整模型流持有 lease；已有 mutation 排队/执行超时或结果未知时，新普通请求会收到 `ControlBarrierError`。
- 卸载取消尚未派发的队列与重试，并取消在途请求信号；不能撤回后端已经收到的操作。
- 未知 mutation 在当前桥接器内隔离。请核查协调器并使用新会话ID继续工作，不要通过重启推断旧操作已结束。

隔离状态不持久化，也不提供跨实例 fencing。后端异步完成仍需后端完成确认/版本协议。详见 [可靠性与验收边界](docs/reliability.md)。

## 开关与配置

```yaml
- id: llm-agent-hint
  config:
    transport: chat
    inheritCredentials: false  # 可选：不复用源凭据
    agentHint:
      sessionControl:
        enabled: false        # 可选：仅保留静态会话Hint，不自动start
```

`agentHint.enabled: false` 关闭全部 Hint 与控制，保留普通协议路由。显式部署示例见 `examples/web.patch.yml`。共享服务升级前应核对目标、协调窗口并保留可回退版本。

## 验证状态

本候选的回归包含真实 stock Loader、AgentLoop、Tools、TokenMeter 与 BasicCompaction：工具两步闭环、压力自动摘要、compact信号、后台不记账及配置更新。模型HTTP为可控本地fixture，不能代替真实模型/KV验收。当前执行记录见 [STANDARDIZATION.md](STANDARDIZATION.md)。

历史 v0.5.x 仓库记录100K长前缀/HBM压力下被动缓存2.35秒、主动预取2.10秒，约10.7% TTFT增量；每场景n=4。91.9%的相对冷态降幅包含外部缓存整体收益。这些是历史特定负载结果，不能当作本候选或一般日常聊天的收益保证。插件不部署模型、不配置memcache，也不承诺无条件加速。

本次修复与验证边界见[2026-10-29修复说明](docs/release-correctness-20261029.md)。[2026-10-26修复说明](docs/manual-review-20261026.md)保留为 rc.2 历史记录，不代表本候选的浏览器触发行为。
