# DSH AgentHint

给 **DSH 0.2.0-rc.1** 增加一条带 `agent_hint` 的 DeepSeek Messages 路由，把会话身份与生命周期信号发给 MindIE-Motor 协调器，用于外部 KV 缓存的卸载与预取。无需修改 DSH 核心。

包名：`@sasimoreyang-ai/dsh-llm-agent-hint`。[English](README.en.md)

## 安装

```sh
dsh plugin --profile <你的 profile> add 'github:sasimoreyang-ai/dsh-agenthint#v0.4.0'
```

装完重启该 DSH 实例，在模型列表中选择 **DeepSeek (agent-hint)**，新建会话即可。

需要 Node.js `^22.19.0 || >=24`、pnpm 和 DSH **0.2.0-rc.1**。Git 包含构建产物，安装无需编译。本包未发布到 npm registry，不使用裸包名安装。

## 不需要配置地址和模型

插件的 `cordis.patch.yml` **不含任何地址、模型或凭据**。端点与模型目录按以下优先级解析：

| 顺序 | 来源 | 说明 |
| --- | --- | --- |
| 1 | 插件条目显式配置 | 操作者填了就用填的 |
| 2 | **继承 `llm-deepseek` 路由** | 从用户已经配好的模型里读 `baseURL` 与 `models` |
| 3 | 环境变量 `DSH_AGENT_HINT_BASE_URL` | 批量部署时设置 |
| 4 | 内置默认 `http://127.0.0.1:1025` | 同机同端口的兜底 |

第 2 条覆盖了绝大多数部署：**能用一个模型的人，必然已经配好了端点**，插件直接复用，不重复问一遍。

设计说明见 [docs/endpoint-inheritance.md](docs/endpoint-inheritance.md)。

## 发出去的内容

普通请求携带 `agent_hint`：

```json
{
  "model": "DeepSeek-V4-Flash",
  "messages": ["...原消息..."],
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
- 压缩、标题生成等辅助请求不带 Hint；无会话身份的请求不带 Hint
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

## 可关闭

```yaml
- id: llm-agent-hint
  config:
    agentHint:
      enabled: false
```

或卸载插件。卸载会撤销注册，不改已有模型配置。

## 验证状态

已在 node_153（Ascend 910B3 × 8 + MindIE-Motor 协调器）实测：

| 项 | 结果 |
| --- | --- |
| 安装与自动组合 | ✅ |
| 端点与模型继承 | ✅ 插件条目零配置，请求成功 |
| 五动词全部触发 | ✅ `start` 22 次、`pause` 18、`resume` 11、`stop` 11、`compact` 1 |
| 引擎四动作执行成功 | ✅ offload / prefetch / evict 各 4,917 块 |

**已知引擎侧限制**：在测试的协调器版本上，`/v1/messages` 路径不向 session-aware 管理器登记块记录，而 `/v1/chat/completions` 会。DSH 的 DeepSeek 适配器使用 Messages 协议，因此经由 DSH 发出的请求当前拿不到可卸载的块。

同一会话改用 `/v1/chat/completions` 播种后，四个动作立即成功：

```
offload  status=True  actual_op_block_num 4917
prefetch status=True  actual_op_block_num 4917
evict    status=True  actual_op_block_num 4917
```

该限制属协调器/引擎侧，插件无法绕过。详见 [STANDARDIZATION.md](STANDARDIZATION.md)。

## 边界

- 插件不部署模型、不配置 memcache/Mooncake、不承诺性能收益
- 引擎必须接受 `agent_hint` 字段；拒绝未知字段的服务会让请求失败
- 继承的是端点与模型目录，**不继承凭据**；协调器需要鉴权时仍须配置 `apiKeyEnv`
- 只支持使用 DeepSeek Messages 协议的路由；`llm-pi-ai` 的 OpenAI/Anthropic 适配器不在范围内
- 无图形界面部署时客户端草稿观察不生效，其余功能正常
