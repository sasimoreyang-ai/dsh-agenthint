# AgentHint Core SDK

`@sasimoreyang-ai/agenthint-core` holds every part of the AgentHint protocol that
does not depend on a particular agent host. This document is the reference for
writing an adapter on top of it.

- Package: `@sasimoreyang-ai/agenthint-core`
- Sub-entry: `@sasimoreyang-ai/agenthint-core/http`
- Runtime: Node 20+, ESM
- Dependencies: none

---

## 1. 分层

```text
宿主适配层（adapter）
  会话身份 | 请求分类 | 凭据 | 传输 | 事件映射
                    │
                    ▼
AgentHint Core
  wire 类型 | hint 构造 | 会话协调器 | 错误码 | 传输契约
                    │
                    ▼
ControlTransport（可选 HTTP 实现）
                    │
                    ▼
协调器 → 引擎 → KV / 外部缓存
```

依赖方向只能向下。Core 不导入 DSH、Cordis、React、Platform、Manager 或任何云 SDK。

---

## 2. 最小接入

```ts
import { HintCoordinator } from '@sasimoreyang-ai/agenthint-core'
import { HttpControlTransport } from '@sasimoreyang-ai/agenthint-core/http'

const coordinator = new HintCoordinator({
  transport: new HttpControlTransport({
    endpoint: 'http://coordinator.example/v1/chat/completions',
    resolveApiKey: async () => process.env.COORDINATOR_KEY,
    defaultModel: 'DeepSeek-V4-Flash',
  }),
})

coordinator.registerSession({ sessionId: 'session-1', seeded: false })

const lease = await coordinator.prepareRequest({
  sessionId: 'session-1',
  requestClass: 'ordinary',
  model: 'DeepSeek-V4-Flash',
})

try {
  const body = {
    model: 'DeepSeek-V4-Flash',
    messages,
    ...lease.hint === undefined ? {} : { agent_hint: lease.hint },
  }
  const response = await send(body)
  lease.accepted()          // 只有端点确实接受后才调用
  await consume(response)
} finally {
  lease.finish()            // 完成 / 出错 / 取消 都要调
}
```

---

## 3. 公开接口

### 3.1 `HintCoordinator`

| 方法 | 用途 |
|---|---|
| `registerSession(facts)` | 宿主告知会话存在；`seeded` 表示带历史创建 |
| `setAgentIdle(sessionId, idle)` | 宿主报告会话是否空闲（延迟 pause 依赖它） |
| `setArchived(sessionId, archived)` | 标记归档；后续 dispose 不再重复 stop |
| `forgetSession(sessionId)` | 丢弃从未发过请求的会话 |
| `facts(sessionId)` | 读 `seeded` / `firstOrdinarySent` / `parentSessionId` |
| `lastModelOf(sessionId)` | 该会话最近使用的模型 |
| `isArchived(sessionId)` | 是否已归档 |
| `awaitPendingOp(sessionId, signal?)` | 等待在途 mutation；超限抛 `CONTROL_BARRIER` |
| `beginOrdinary(sessionId, model, signal?)` | 取流 lease，返回 release 函数 |
| `noteOrdinaryRequest(sessionId, model)` | 提交 `start` 记账（仅在 accepted 后） |
| `prepareRequest(facts)` | 上述两步 + 构造 hint 的组合入口 |
| `buildHint(facts)` | 仅构造 wire 字段 |
| `ensureResume(sessionId, model)` | 请求 advisory 预取，每暂停周期一次 |
| `requestPause(sessionId, model?)` | 延迟 pause，空闲时才发送 |
| `requestControl(intent)` | 立即排队发送一个动词 |
| `archiveSession(sessionId)` | 归档并发送一次 stop |
| `releaseSession(sessionId)` | 发送终态 stop，稳定后丢弃状态 |
| `dispose()` | 取消等待与发送；不再产生控制请求 |

### 3.2 类型

```ts
type RequestClass = 'ordinary' | 'background'
type ControlVerb = 'start' | 'pause' | 'resume' | 'compact' | 'stop'

interface SessionFacts { sessionId: string; seeded: boolean; parentSessionId?: string }
interface RequestFacts { sessionId?: string; requestClass: RequestClass; model: string; signal?: AbortSignal; cacheControl?: AgentHintCacheControl }
interface RequestLease { hint?: AgentHintWire; accepted(): void; finish(): void }

type ControlResult =
  | { status: 'accepted'; httpStatus: number }
  | { status: 'failed'; retryable: boolean; httpStatus?: number }
  | { status: 'unknown' }
  | { status: 'cancelled'; dispatched: boolean }

interface ControlTransport { send(command: ControlCommand): Promise<ControlResult> }
```

### 3.3 错误

```ts
class AgentHintError extends Error { readonly code: 'CONTROL_BARRIER' | 'INVALID_INPUT' | 'DISPOSED' }
```

适配层负责把 `code` 映射到宿主错误类型。**`CONTROL_BARRIER` 不能被映射成可重试的传输错误。**

---

## 4. 行为合同

| # | 合同 |
|---|---|
| 1 | `accepted` 只表示 HTTP 接受，不表示 KV 完成 |
| 2 | `pause` / `compact` / `stop` 不自动重试；unknown 结果隔离会话 |
| 3 | `CONTROL_BARRIER` 不是 `TRANSPORT`，不得被宿主通用重试 |
| 4 | 流 lease 覆盖整个流；错误、取消、放弃都必须释放 |
| 5 | 后台请求不消耗 `start`、不触发会话记账 |
| 6 | 端点、凭据引用、路由代在**一次**解析中固定 |
| 7 | 跨 origin 不携带模型密钥；控制需独立授权 |
| 8 | 每个 scope 一个协调器实例；不同 scope 不串扰 |
| 9 | 关闭或降级 Hint 不能绕过同会话的 unknown mutation |
| 10 | 插件加载 / provider 选中 / Hint 到达 / KV 完成 / 收益，分别报告 |

---

## 5. 为什么 `lastOrdinarySessionId` 不在 Core 里

「用户切走了，该暂停哪个会话」是**交互策略**，只在某一个宿主的交互模型内成立。

放进 Core 会让一个共享运行时里，用户 B 的请求暂停用户 A 的会话。

所以：

- **Core**：接收显式 `requestPause(sessionId)` 意图，负责安全排队
- **适配层**：按自己的作用域决定何时发出这个意图

DSH 适配层把 `lastOrdinarySessionId` 放在 `LifecycleBridge` 实例上，一个实例对应一个插件作用域。

---

## 6. 可选 HTTP 传输

`@sasimoreyang-ai/agenthint-core/http` 实现当前协调器协议：空 `messages` 的
chat-completions 请求，携带 `agent_hint.session_control`。

只有后端确实说这套协议时才导入它。协调器本身只依赖 `ControlTransport` 接口，
换协议只需换实现。

```ts
new HttpControlTransport({
  resolveConnection: async () => ({ endpoint, apiKey, authHeader: 'authorization', headers }),
  defaultModel: 'DeepSeek-V4-Flash',
  timeoutMs: 5_000,     // 默认
  retries: 1,           // 仅 resume 使用
  warn: (msg, err) => logger.warn(msg, err),
})
```

`resolveConnection` 每次 `send` 调用一次，返回的快照在该次命令内不变 —— 这保证
配置中途变更不会把控制请求发到另一个 origin。

---

## 7. 测试

Core 的行为测试在 `packages/agenthint-core/tests/core.spec.ts`，只导入本包，
不导入任何宿主。这本身就是「核心可独立工作」的结构性证明。

```bash
npx vitest run packages/agenthint-core
```
