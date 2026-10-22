# 传输选择：为什么默认走 chat/completions

日期：2026-10-22；宿主基线：npm DSH 0.2.0-rc.1。

## 问题

外部 KV 缓存按会话工作，引擎必须收到 `agent_hint`。但原厂镜像的两个入口对它的支持不同。

### 证据（原厂镜像，未打补丁）

```
$ docker exec deployer_vllm_mmc grep -c agent_hint \
    /vllm-workspace/vllm/vllm/entrypoints/anthropic/protocol.py
0

$ docker exec deployer_vllm_mmc grep -c agent_hint \
    /vllm-workspace/vllm/vllm/entrypoints/openai/chat_completion/protocol.py
9
```

Anthropic 入口的请求模型没有声明该字段，Pydantic 按默认策略丢弃未知键；OpenAI 入口声明了，字段得以保留。

### 后果

Messages 路径上：

- 请求本身成功（HTTP 200），用户无感
- 但会话挂不上：`register context management … session id None`
- 于是 `pause` / `resume` 找到会话却找不到块：`has 0 hash/block in SAM`
- 控制动作全部变成 no-op，日志里只有一条 WARN

这不是插件发错了请求，是**发到了一条引擎不认的通道上**。

## 两条路

| 方案 | 代价 | 结论 |
| --- | --- | --- |
| 引擎侧补两行（在 Anthropic 请求模型声明该字段，并在转换时拷贝） | 需要改镜像；容器重建即失效 | 可行但不可交付 |
| **插件侧改用 chat/completions** | 纯插件改动 | **本方案** |

## 实现

`src/chat-adapter.ts` 提供 `ChatCompletionsAdapter`：

| 组件 | 职责 |
| --- | --- |
| 请求构造 | `GenerateOptions` → chat/completions 请求体（messages / tools / max_tokens / stop / temperature） |
| SSE 解码 | 按 `\n\n` 切帧，取 `data:` 载荷，跳过 `[DONE]` 与畸形帧 |
| 分块翻译 | `delta.reasoning` 或 `delta.reasoning_content` → `reasoning-delta`；`delta.content` → `text-delta`；`delta.tool_calls` → `tool-call-delta` |
| 用量与终止 | `usage` → `TokenUsage`（拆出缓存读入）；`finish_reason` → `FinishReason` |
| 空响应守卫 | 无文本且无工具调用时抛 `EMPTY_RESPONSE` |

### 与 Messages 传输共用

两种传输只替换「怎么发请求、怎么解析响应」，以下完全共用：

- `buildAgentHint` 的 hint 构造规则（`src/agent-hint.ts`）
- `LifecycleBridge` 的控制面屏障与 `start` 记账（`src/lifecycle-bridge.ts`）
- `accept` 事务：只有 HTTP 2xx 之后才推进记账

### 字段名兼容

不同协调器对思维链的字段名不一致：

| 字段名 | 来源 |
| --- | --- |
| `reasoning_content` | OpenAI 兼容惯例 |
| `reasoning` | 本协调器实际使用 |

适配器同时接受两者。这是 v0.5.2 修的问题——只认前者会导致思维链全部丢失。

## 控制面不受影响

控制请求本来就发往 `<baseURL>/v1/chat/completions`，与数据面传输选择无关。切换传输不改变控制面行为。

## 验证

原厂镜像、`transport: chat`：

| 检查 | 结果 |
| --- | --- |
| 抓包：普通请求携带 `agent_hint` | ✅ `{"session_id": "...", "session_control": {"type": "start"}}` |
| 抓包：后台请求不带 `agent_hint` | ✅ |
| 会话挂载 | ✅ `session id session-…` |
| 块登记到会话 | ✅ `on_blocks_allocated_for_request, session_id = session-…` |
| `pause` → offload | ✅ `status=True`，676–678 块 |
| `resume` → prefetch | ✅ `status=True`，678 块 |
| `stop` → evict | ✅ `status=True`，678 块 |

## 何时仍用 messages

只有当引擎的 Anthropic 入口已经自行声明并转发 `agent_hint` 时。此时两种传输等价，`messages` 可以省掉一次协议转换。

判断方法：在目标镜像里执行上文的两条 `grep`。Anthropic 侧非 0 即可用 `messages`。

## 未覆盖

- 图片、文件、工具声明类内容块在 chat 传输下被丢弃（协调器无对应字段），不报错
- 未测 `llm-pi-ai` 的 OpenAI/Anthropic 适配器组合
