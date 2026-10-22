# DSH AgentHint

给 **DSH 0.2.0-rc.1** 增加一条带 `agent_hint` 的 DeepSeek 路由，把会话身份与生命周期信号发给 MindIE-Motor 协调器，用于外部 KV 缓存的卸载与预取。**不需要修改引擎。**

包名：`@sasimoreyang-ai/dsh-llm-agent-hint`。[English](README.en.md)

## 为什么需要它

外部 KV 缓存要按会话工作，引擎必须收到 `agent_hint`。但原厂引擎的两个入口对此支持不同：

| 入口 | 原厂是否接受 `agent_hint` | 后果 |
| --- | --- | --- |
| `/v1/messages`（Anthropic） | ❌ 未声明该字段，Pydantic 静默丢弃 | 会话挂不上，`pause`/`resume` 空转 |
| `/v1/chat/completions`（OpenAI） | ✅ 已声明 | 会话正常挂载 |

DSH 自带的 DeepSeek 适配器走 Messages。本插件默认改用 chat/completions 传输，**在原厂引擎上即可让生命周期控制生效**。

## 安装

```sh
dsh plugin --profile <你的 profile> add 'github:sasimoreyang-ai/dsh-agenthint#v0.5.1'
```

装完重启该 DSH 实例，在模型列表中选择 **DeepSeek (agent-hint)**，新建会话即可。

需要 Node.js `^22.19.0 || >=24`、pnpm 和 DSH **0.2.0-rc.1**。本包未发布到 npm registry。

## 不需要配置地址和模型

插件条目不含任何地址、模型或凭据。端点与模型目录按以下优先级解析：

| 顺序 | 来源 |
| --- | --- |
| 1 | 插件条目显式配置 |
| 2 | **继承 `llm-deepseek` 路由**（读它的 `baseURL` 与 `models`） |
| 3 | 环境变量 `DSH_AGENT_HINT_BASE_URL` |
| 4 | 内置默认 `http://127.0.0.1:1025` |

第 2 条覆盖绝大多数部署：能用一个模型的人，必然已经配好了端点。

## 传输选择

```yaml
- id: llm-agent-hint
  config:
    transport: chat     # 默认；原厂引擎可用
    # transport: messages   # 仅当引擎的 Messages 入口已声明 agent_hint
```

`chat` 走 OpenAI chat/completions，`messages` 走 Anthropic Messages。两者共用同一套 hint 构造、生命周期桥接与控制面。

## 发出去的内容

```json
{
  "model": "DeepSeek-V4-Flash",
  "messages": ["..."],
  "agent_hint": {
    "session_id": "当前会话 ID",
    "parent_session_id": "分叉时的父会话 ID（可选）",
    "cache_control": { "type": "..." },
    "session_control": { "type": "start" }
  }
}
```

- `session_control` 只在特定时机出现：新会话首次普通请求带 `start`
- `pause` / `resume` / `stop` / `compact` 作为独立 manage 请求发往 `<baseURL>/v1/chat/completions`
- 压缩、标题生成等辅助请求不带 hint；无会话身份的请求不带 hint
- 插件不添加任何模型可见提示词

## 生命周期控制

| 动作 | 触发时机 | 引擎侧效果 |
| --- | --- | --- |
| `start` | 新会话首次普通请求 | 登记会话 |
| `pause` | 切走到其他会话 | 卸载（offload） |
| `resume` | 切回该会话 | 预取（prefetch） |
| `compact` | 上下文压缩后 | 驱逐（evict） |
| `stop` | 会话销毁或归档 | 驱逐（evict） |

所有控制动作**失败开放**：超时、网络错误、非 2xx 只记告警，不阻塞对话。

## 验证状态

在 node_153（Ascend 910B3 × 8 + MindIE-Motor + memcache）实测，**引擎为原厂镜像，未打任何补丁**：

| 项 | 结果 |
| --- | --- |
| 安装与自动组合 | ✅ |
| 端点与模型继承 | ✅ 插件条目零配置，请求成功 |
| chat 传输下会话挂载 | ✅ `session id` 正常注册 |
| 块分配 | ✅ `on_blocks_allocated_for_request` 记录到会话 |
| `pause` → offload | ✅ `status=True`，4,917 块 |
| 五动词全部触发 | ✅ `start` / `pause` / `resume` / `stop` / `compact` |

`transport: messages` 在未声明该字段的引擎上会静默降级：请求正常，但 `pause`/`resume` 找不到块。

## 可关闭

```yaml
- id: llm-agent-hint
  config:
    agentHint:
      enabled: false
```

## 边界

- 插件不部署模型、不配置 memcache、不承诺性能收益
- 引擎必须接受 `agent_hint`；拒绝未知字段的服务会让请求失败
- 继承的是端点与模型目录，**不继承凭据**；需要鉴权时配置 `apiKeyEnv`
- 图片、文件、工具声明类内容块在 chat 传输下会被丢弃，不报错
- 无图形界面部署时客户端草稿观察不生效，其余功能正常