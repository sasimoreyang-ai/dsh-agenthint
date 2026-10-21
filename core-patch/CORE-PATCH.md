# AgentHint 核心改动历史提案（路径 A）

> 历史备选：本仓当前已提供不改核心的路径 B，安装无需应用下列补丁。当前说明见 [README](../README.md) 和 [路径 B](../docs/path-b.md)。下文保留此前背景，不作为当前能力结论。

**目标 DSH 版本**：`0.2.0-rc.1`
**改动范围**：3 个核心包，共 4 处
**性质**：纯增量（新增 2 个事件 + 1 个 Remote 方法 + 1 个请求类型），不修改任何既有行为

---

## 为什么需要这些改动

`@deepseek-ai/dsh-llm-agent-hint` 的控制面要把 DSH 的会话生命周期映射成协调器的 `session_control` 动词：

| 动词 | 触发源 | 官方 DSH 是否有 |
|---|---|---|
| `start` | 会话首条被接受的普通请求 | ✅ 有（`agent/status` + 请求路径） |
| `pause` | 另一会话产生被接受的请求，原前台会话 idle | ✅ 有（`agent/status`） |
| `compact` | `compaction/end` 且无 error | ✅ 有 |
| **`resume`** | **会话输入框草稿由空变非空** | ❌ **无** |
| **`stop`** | **会话归档** | ❌ **无（rc.2 改成 registry 查询，不是事件）** |

所以缺两个事件。没有它们，插件的 `resume` / `stop` 两个动词永远不会触发。

---

## 改动 1：`packages/core/agent/src/runtime-types.ts`

在 `Events` 接口内（`session/composing` 相关区块）新增：

```ts
    /**
     * A client reported that a session's composer draft became non-empty.
     * Advisory only: the Host never resumes or publishes an Agent from it.
     * @param sessionId - session whose composer became active.
     * @mode emit
     */
    'session/composing'(sessionId: SessionId): void
```

---

## 改动 2：`packages/workspace/workspace/src/index.ts`

### 2a. 事件声明（`Events` 接口内）

```ts
    /**
     * A session became hidden from every workspace grouping surface. Emitted
     * after the archive set is durable, once per session and archive.
     * @param sessionId - the session just archived.
     * @mode emit
     */
    'workspace/session-archived'(sessionId: SessionId): void
```

### 2b. 发射点（归档落盘之后）

在 `setState({ ...archivedSessionIds: [...state.archivedSessionIds, sessionId] ... })` 之后、`stopSessionActivity` 之前插入一行：

```ts
      this.ctx.emit('workspace/session-archived', sessionId)
```

**时序要求**：必须在归档状态持久化之后发射，保证监听方看到的是已生效的事实。

---

## 改动 3：`packages/api/session-controller/src/types.ts`

```ts
export interface SessionNoteComposingRequest {
  readonly sessionId: SessionId
}
```

---

## 改动 4：`packages/api/session-controller/src/index.ts`

### 4a. 导入新类型

在 `types.ts` 的导入列表中加入 `SessionNoteComposingRequest`。

### 4b. 新增 Remote 方法（放在 `rename` 之后）

```ts
  /**
   * Note that a Session's composer draft became non-empty. Advisory only: the
   * Host emits `session/composing` for control-plane listeners and never
   * resumes or publishes an Agent from it; an unknown Session is accepted
   * silently.
   * @param request - Session whose composer became active.
   */
  @Remote('noteComposing')
  noteComposing(request: SessionNoteComposingRequest): void {
    this.ctx.emit('session/composing', request.sessionId)
  }
```

---

## 设计取舍说明（供评审）

### 为什么 `resume` 用 composing 而不是别的

`resume` 的语义是"用户要回到这个会话了，提前把 KV 搬回来"。DSH 里唯一能提前感知的客户端信号就是输入框草稿。其他候选都不合适：

| 候选 | 为什么不行 |
|---|---|
| 切回会话 | 纯 UI 切换不产生 Host 事件，且用户可能只是看一眼 |
| 会话被选中 | 同上 |
| 提前发请求 | 那已经是 `actual`，没有"提前"可言 |

### 为什么 `stop` 用归档而不是销毁

`session/disposed` 已经存在，但它是**终态**（进程退出、会话删除）。归档是**可逆的隐藏**，更符合 `stop`（evict 但数据仍可恢复）的语义。

rc.2 把归档改成了 registry 查询（`archived-session-gate.ts`），没有事件。**如果上游接受本提案，rc.2 需要补一个等价的归档事件。**

### 为什么都是 `@mode emit` 且 advisory

两个事件都只用于通知，不改变 Host 的调度、不恢复 Agent、不影响任何既有消费者。插件的控制面本身是 fail-open（失败只 WARN），所以事件缺失时功能降级而不是报错。

---

## 验证方式

1. 应用上述 4 处改动
2. 在 DSH 仓库内编译：`npx tsc -b packages/llm/llm-agent-hint --force`
3. 预期：0 error
4. 参考实现（含 49 个单测）在 `dsh-v0.2.0-agent-hint-rc.1` 分支
