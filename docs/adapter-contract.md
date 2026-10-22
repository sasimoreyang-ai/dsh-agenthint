# 适配层能力合同

要让一个新的 Agent 宿主接入 AgentHint，需要提交一张**有证据的能力表**，不能只声明「支持 AgentHint」。

本文定义这张表：每项能力必须证明什么、缺了会怎样。DSH 的现有实现作为参考填在最后一列。

---

## 1. 能力矩阵

| # | 能力 | 必须证明 | 缺失时的行为 | DSH 实现 |
|---|---|---|---|---|
| 1 | `stableSessionId` | 请求与控制可关联到同一个真实会话 | 不发会话 Hint；**不得用用户名代替会话** | `session.id` |
| 2 | `classifyRequest` | 普通、摘要、标题、后台调用可区分 | 降级或拒绝 Hint，避免后台污染 | `purpose !== undefined` → `background` |
| 3 | `injectRequest` | 每个真实模型请求都能可靠注入 body | 只有 hooks 不算数据面接入 | `prepareExtensions` 注入 `agent_hint` |
| 4 | `observeAcceptance` | 实际请求被接受/提交的时机可观察 | 不能提前提交 `start` 状态 | extension 的 `accept()` 事务 |
| 5 | `streamLifetime` | 完成/失败/取消可释放完整流 lease | 不承诺 mutation 与推理安全互斥 | `AgentHintAdapter.leased()` |
| 6 | `compactCommitted` | 摘要真正持久化/切换成功的事件 | 不自动发 `compact` | `compaction/end` 且无 `error` |
| 7 | `endVsDisconnect` | 分清结束、断连、资源卸载 | **不把断连映射为 `stop`** | `session/disposed` + `workspace/session-archived` |
| 8 | `scopedIdentity` | 多用户/分支/子 Agent 可隔离 | 限制部署模式，不能共享裸 ID | 每插件实例一个 `LifecycleBridge` |

---

## 2. 逐项说明

### 2.1 `stableSessionId`

后端按 `session_id` 决定 KV 缓存归属。如果同一个 ID 在不同用户之间复用，缓存会串。

要求：

- 会话 ID 来自宿主真实会话，不是拼接的用户名或时间戳
- 多租户场景下，宿主必须提供作用域化的 ID，或由适配层加命名空间前缀
- **SDK 内部的 Map 分区不等于后端 KV 分区**：需要后端与适配层对同一映射达成一致

### 2.2 `classifyRequest`

后台调用（标题、摘要、检索改写）与用户对话共用同一个模型端点，但**不能携带会话 Hint**：
一旦携带，后端会把标题请求的块算进会话缓存，污染会话身份。

DSH 的分类规则是「`purpose` 有值即后台」。这条规则**是 DSH 语义，不是通用规则**，
其他宿主必须给出自己的分类依据（如 `is_title_generation`、`call_site` 字段）。

未识别的请求类别**不得默认为普通**，应明确分类或拒绝启用 Hint。

### 2.3 `injectRequest`

必须能改写实际发往后端的请求体。

只提供「请求前事件」是不够的：事件回调若拿不到可变 body，或改完后被宿主覆盖，
数据面就没有真正接入。

DSH 踩过这个坑：辅助注册函数在展开参数后覆盖了 `prepareExtensions`，
类型检查通过、运行时无报错，但字段从未注入。见 `docs/migration.md` §4。

### 2.4 `observeAcceptance`

`start` 只能声明一次。如果在构造请求时就记账，一个被拒绝的请求会白白消耗这次声明，
导致真正成功的首个请求不再声明 `start`，后端始终认为会话未开始。

要求：在宿主确认请求已被接受的位置调用 `lease.accepted()`。

### 2.5 `streamLifetime`

`pause` / `stop` 必须等模型流结束。若在流未结束时发送，
后端可能在生成过程中卸载正在使用的块。

要求：租约覆盖**整个流**，并且完成、出错、取消、调用方提前退出迭代器四条路径都释放。

### 2.6 `compactCommitted`

只有摘要**真正持久化成功**后才能发 `compact`。
摘要失败时发 `compact` 会让后端驱逐一个仍然需要的会话。

DSH 的判据：`compaction/end` 事件且 `data.error === undefined`。

### 2.7 `endVsDisconnect`

这是最容易做错的一项。

| 宿主事件 | 是否等于「用户结束会话」 |
|---|---|
| 资源卸载 | 否 |
| 窗口断开 | 否 |
| 进程退出 | 否 |
| 归档 | 是 |
| 永久删除 | 是 |

把断连映射成 `stop` 会驱逐一个用户马上要回来的会话，反而降低命中率。

### 2.8 `scopedIdentity`

一个协调器实例只能服务一个信任作用域。

- 单用户运行时：一个实例
- 多用户共享服务：每用户一个实例，或每工作区一个
- 子 Agent：宿主分配独立会话 ID，或显式共享父会话并声明谱系

**不能让两个用户共用一个 `lastOrdinarySessionId`**，否则 B 的活动会暂停 A 的会话。

---

## 3. 提交模板

新适配层请在 PR 中附上这张表，每项填「证据」而不是「已实现」：

```markdown
| 能力 | 证据 | 等级 |
|---|---|---|
| stableSessionId | `<文件>:<行>` 会话 ID 来源 | 已证明 / 部分 / 缺失 |
| classifyRequest | `<文件>:<行>` 分类规则 | … |
| injectRequest | 抓包记录 / 测试名 | … |
| observeAcceptance | `<文件>:<行>` 记账时机 | … |
| streamLifetime | 测试名 | … |
| compactCommitted | 事件名与判据 | … |
| endVsDisconnect | 事件映射表 | … |
| scopedIdentity | 作用域划分方式 | … |
```

---

## 4. 最小验证宿主

`packages/agenthint-core/tests/core.spec.ts` 是一个**没有任何宿主依赖**的最小验证宿主：
它只导入 Core，用假传输驱动完整状态机。

这证明「核心可独立工作」，**不等于第二个真实 Agent 已适配**。
真实适配仍需要上面八项各自的行为证据。

---

## 5. 后续适配（Claude 方向）

需要先区分三种对象：Claude 模型 API、自建调用 Claude 的 Agent、Claude Code。

验证顺序：

1. 固定具体产品与版本
2. 检查可用生命周期事件
3. 验证每请求的 session/subagent 身份关联
4. 验证请求注入点（能否改写 body）
5. 验证后台调用分类
6. 验证流与取消控制
7. 确认目标后端及鉴权协议支持 Hint

若只能通过独立进程的 hooks 接入，不能每次新建一个无状态协调器并声称已实现队列互斥——
需要明确协调器进程与状态所有者。

**Claude 官方云推理与本地的 memcache offload/prefetch 不是同一能力**，不能把商业云的缓存机制等同于这里的会话缓存控制。
