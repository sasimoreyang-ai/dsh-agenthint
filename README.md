# DSH AgentHint

给 **DSH 0.2.0-rc.1** 增加一条带 `agent_hint` 的 DeepSeek 路由，把会话身份与生命周期信号发给 MindIE-Motor 协调器，用于外部 KV 缓存的卸载与预取。

**不需要修改引擎，不需要修改 Motor。** 装上即可在原厂镜像上工作。

包名：`@sasimoreyang-ai/dsh-llm-agent-hint` · [English](README.en.md)

---

## 为什么需要它

外部 KV 缓存要按会话工作，引擎必须收到 `agent_hint`。但原厂引擎的两个入口对此支持不同：

| 入口 | 原厂是否声明 `agent_hint` | 后果 |
| --- | --- | --- |
| `/v1/messages`（Anthropic） | ❌ 未声明，请求模型静默丢弃 | 会话挂不上，`pause`/`resume` 空转 |
| `/v1/chat/completions`（OpenAI） | ✅ 已声明 | 会话正常挂载，块正常登记 |

DSH 自带的 DeepSeek 适配器走 Messages。本插件默认改用 chat/completions 传输，**在原厂引擎上即可让生命周期控制生效**。

详见 [docs/transport.md](docs/transport.md)。

---

## 安装

```sh
dsh plugin --profile <你的 profile> add 'github:sasimoreyang-ai/dsh-agenthint#v0.5.2'
```

需要 Node.js `^22.19.0 || >=24`、pnpm 和 DSH **0.2.0-rc.1**。构建产物已提交，安装无需编译。未发布到 npm registry。

---

## 装上之后还要做什么

**只需一步：把默认模型指向插件路由。**

插件注册自己的路由 `deepseek-agent-hint`，而 DSH 出厂默认是 `deepseek-official`。不切换的话，会话仍走原路由，hint 不会发出。

### 做法 A：界面里选一次

重启 DSH → 模型选择器 → 选 **DeepSeek (agent-hint)** → 新建会话。

### 做法 B：部署时预置（用户零操作）

```yaml
- id: agent-default-model
  config:
    provider: deepseek-agent-hint
    model: DeepSeek-V4-Flash
```

一体机出厂或批量部署推荐做法 B。

---

## 不需要配置地址和模型

插件条目不含任何地址、模型或凭据：

```yaml
- id: llm-agent-hint
  config: {}        # 全部继承
```

端点与模型目录按以下优先级解析：

| 顺序 | 来源 |
| --- | --- |
| 1 | 插件条目显式配置 |
| 2 | **继承 `llm-deepseek` 路由**（读它的 `baseURL` 与 `models`） |
| 3 | 环境变量 `DSH_AGENT_HINT_BASE_URL` |
| 4 | 内置默认 `http://127.0.0.1:1025` |

第 2 条覆盖绝大多数部署：能用一个模型的人，必然已经配好了端点。详见 [docs/endpoint-inheritance.md](docs/endpoint-inheritance.md)。

---

## 传输选择

```yaml
- id: llm-agent-hint
  config:
    transport: chat        # 默认；原厂引擎可用
    # transport: messages  # 仅当引擎的 Messages 入口已声明 agent_hint
```

| 传输 | 数据面端点 | 适用 |
| --- | --- | --- |
| `chat` | `/v1/chat/completions` | **原厂引擎（推荐）** |
| `messages` | `/v1/messages` | 引擎已自行支持该字段时 |

两种传输共用同一套 hint 构造、生命周期桥接与控制面。控制请求始终走 `/v1/chat/completions`。

---

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
- 压缩、标题生成等辅助请求**不带** hint；无会话身份的请求**不带** hint
- 插件不添加任何模型可见提示词

---

## 生命周期控制

| 动作 | 触发时机 | 引擎侧效果 |
| --- | --- | --- |
| `start` | 新会话首次普通请求 | 登记会话 |
| `pause` | 切走到其他会话 | 卸载（offload） |
| `resume` | 切回该会话 | 预取（prefetch） |
| `compact` | 上下文压缩后 | 驱逐（evict） |
| `stop` | 会话销毁或归档 | 驱逐（evict） |

所有控制动作**失败开放**：超时、网络错误、非 2xx 只记告警，不阻塞对话。

---

## 实测收益

在 node_153（Ascend 910B3 × 8 + MindIE-Motor + memcache）实测，**引擎为原厂镜像，未打任何补丁**。

### 端到端 TTFT（100K 长前缀 + HBM 压力）

| 场景 | TTFT |
| --- | --- |
| 冷态（完整 prefill） | **25.74 s** |
| 连接器被动缓存（无 Hint） | **2.35 s** |
| **加 Hint 主动预取** | **2.10 s** |

| 对比 | 降幅 |
| --- | --- |
| **Hint 增量**（主动预取 vs 被动载入） | **10.7%** |
| 端到端合计（vs 冷态） | **91.9%** |

预取耗时约 1.03 s，被用户输入间隔完整隐藏。

### 原厂引擎上的控制面

```
offload  status=True  676–678 块
prefetch status=True  676–678 块
evict    status=True  676–678 块
```

零失败、零 no-op。

### ⚠️ 收益的前提

| 条件 | 说明 |
| --- | --- |
| **前缀要长** | 100K 下 10.7%；**26K 短会话增量接近 0** |
| **HBM 要有压力** | 否则一直命中本地，预取无用武之地 |
| **要有提前量** | 预取约 1.03 s，输入间隔短于此值收益打折 |

**普通日常聊天（几 K token）拿不到 Hint 收益** —— 这是机制决定的，不是配置问题。

---

## 可关闭

```yaml
- id: llm-agent-hint
  config:
    agentHint:
      enabled: false
```

---

## 边界

- 插件不部署模型、不配置 memcache、不承诺无条件性能收益
- 引擎必须接受 `agent_hint`；拒绝未知字段的服务会让请求失败
- 继承的是端点与模型目录，**不继承凭据**；需要鉴权时配置 `apiKeyEnv`
- 图片、文件、工具声明类内容块在 chat 传输下会被丢弃，不报错
- 无图形界面部署时客户端草稿观察不生效，其余功能正常

---

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/transport.md](docs/transport.md) | 为什么默认走 chat/completions |
| [docs/endpoint-inheritance.md](docs/endpoint-inheritance.md) | 端点与模型继承的设计与优先级 |
| [docs/path-b.md](docs/path-b.md) | 独立协调器控制面的实现说明 |
| [STANDARDIZATION.md](STANDARDIZATION.md) | 逐版本的实现与验证记录 |
