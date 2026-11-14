# AgentHint 移植记录：DSH 0.2.0-rc.2 → 0.2.2-rc.1

- 包：`@sasimoreyang-ai/dsh-llm-agent-hint` 0.6.0-rc.8
- 分支：`feat/dsh-0.2.2-rc.1`
- 目标宿主：DSH **0.2.2-rc.1**、cordis **4.1.0**、cordis-plugin-loader **1.1.0**、schemastery **3.19.0**
- 依据：两版包内 `lib/types/*.d.ts` 逐文件比对（旧版取自有 `package-lock.json` 固定 integrity 的 `node_modules`，新版取自 registry tarball）。

源码基线判断：`dh-review` 的 `src/` 已与 `mindagent-platform/.../plugin-agent-hint`（0.6.0-rc.8）**逐字节一致**（仅行尾 CRLF/LF 差异），差异只有 platform 侧的三处本地改动（`padControlMessages` 选项、包名改为 `mindagent-dsh-llm-agent-hint`、测试跑 `node --test`）。因此按「已同步」处理，直接在其上改，**未**用 platform 版本覆盖 `package.json`（那会把发布包名改成 platform 内部名、丢掉 `files`/vitest）。platform 的 `padControlMessages` 属于其本地特性，本次不引入，见「遗留风险」。

## 一、破坏性变更修复（①~⑤）

### ① P0 — cordis `Fiber.config` 语义反转

`src/inherited-connection.ts`（`readInheritedConnection`）：

```ts
// cordis >= 4.1 exposes the schema-validated config (defaults materialized) as
// `effectiveConfig`; `fiber.config` is only the raw loader input, so reading it
// here would hand the resolver unresolved/expression-bearing values. The property
// is typed `unknown`, so narrow it to the parsed Config shape this resolver expects.
const effective: unknown = fiber.effectiveConfig
if (effective === null || typeof effective !== 'object') return {}
options = plainOptions(effective as Parameters<typeof plainOptions>[0])
```

为什么：旧版 `fiber.config` 是已按 schema 校验、默认值已 materialize 的配置；0.2.2 中 `Fiber.config: any` 只是**原始 loader 输入**（注释原文 "Raw plugin input retained for the next activation"），校验后的对象在 `Fiber.effectiveConfig: unknown`。继续读 `fiber.config` 会把未解析的值交给 `resolveAdapterOptions`，属于静默错误而非类型错误（`any` 使 tsc 无法发现）。`fiber.state !== 2`（`FiberState.ACTIVE`）时返回 `{}` 的既有逻辑保留；额外的 `typeof === 'object'` 守卫让 `unknown` 在断言前先被收窄。

### ② P1 — `SessionStore.fork()` 不再写 `header.parentSession`

`src/lifecycle-bridge.ts`（`onSessionCreated` + 新增私有方法）：

```ts
state.parentSessionId = this.compactionParentOf(session, state.seeded)
```

```ts
private compactionParentOf(session: Session, seeded: boolean): SessionId | undefined {
  const header = session.header
  // `origin === 'subagent'` marks a subagent child. Its `parentSession` names that
  // subagent's creator, never a session this one was compacted away from.
  if (header.origin === 'subagent') return undefined
  // Historical (pre-0.2.2) ordinary forks still carry their source id here.
  if (header.parentSession !== undefined) return header.parentSession
  const recent = this.recentCompaction
  if (recent === undefined) return undefined
  if (Date.now() - recent.at > COMPACTION_LINEAGE_WINDOW_MS) { this.recentCompaction = undefined; return undefined }
  if (String(recent.sessionId) === String(session.id) || !seeded) return undefined
  // One observed compaction plausibly explains one forked session; consume the hint so a
  // second seeded session inside the same window is not mis-attributed to the same parent.
  this.recentCompaction = undefined
  return recent.sessionId
}
```

配套改动：
- 新常量 `COMPACTION_LINEAGE_WINDOW_MS = 60_000`（并从 `src/index.ts` 导出）。
- 新字段 `private recentCompaction: { sessionId: SessionId; at: number } | undefined`，在 `onSessionEvent` 观察到成功的 `compaction/end` 时写入（`error !== undefined` 的失败压缩不写，`dispose()` 清空）。
- 方法 JSDoc 明确写出「新版 DSH 不再持久化普通 fork 的父会话，此处为启发式推断」以及窗口外/同窗口两次降级为「未知血缘」而**不是**报错。
- `src/index.ts` 中 `prepareHint` 的兜底分支（原 `:157`）新增注释说明血缘来源：无 bridge 时永不报父会话，有 bridge 时由 `origin` + `compaction/end` 启发式提供。

为什么：0.2.2 的 `SessionHeader.parentSession` 语义改为「**子 agent 的直接创建者**」，普通 fork 不再写该字段（`types.d.ts` 注释："Ordinary forks omit this field; historical ordinary forks may retain their source id here. Presence alone does not classify a Session as a subagent; use `origin` for that distinction."）。因此必须先用 `origin` 把 subagent 谱系排除（否则会把 subagent 血缘误当成压缩父会话，协调器侧会挂错缓存链），再对普通 fork 用启发式补血缘。

### ③ P1 — `purpose` 从闭集改为泛型声明合并

`src/chat-adapter.ts`：

```ts
export interface ChatRequestFacts {
  sessionId: string | undefined
  /**
   * Declared request purpose, or `undefined` for an ordinary conversation request.
   * DSH 0.2.2 made purposes an open, declaration-merged key set
   * (`GenerateOptions<Purpose extends string>`), so a forwarding adapter must treat
   * this as a plain string rather than the old `'compaction' | 'session-title'` union.
   */
  purpose: string | undefined
  ...
}
```

`src/agent-hint.ts`：`AgentHintInputs.purpose` 的说明与 `buildAgentHint` 规则 1 的注释改为「任意 purpose 都视为后台调用，不注入 hint」。类型仍写作 `DeepSeekLlmApiExtensionRequest['purpose']`——0.2.2 已把它宽化为 `readonly purpose?: string`（即 `string | undefined`），与目标类型一致。

`src/extension.ts`：两处 `request.purpose`（原 `:48`、`:61`）**无需改代码**——入参类型本来就是 `string | undefined`，`=== undefined` 的判断与 `buildAgentHint` 调用均未变。这一点与交接说明里「`extension.ts` 受影响」不同：在新版 `.d.ts` 下它已经不构成类型问题，仅行为语义（任意 purpose 都跳过注入）随之生效。

为什么：旧版 `GenerateOptions.purpose?: 'compaction' | 'session-title'`；新版为 `GenerateOptions<Purpose extends string = LlmRequestPurpose> { purpose?: Purpose }`，`LlmRequestPurpose = Extract<keyof LlmRequestPurposeMap, string>`，而 `LlmRequestPurposeMap` 在 `dsh-llm` 中是空接口，由生产者包（`dsh-compaction-basic`、`dsh-session-title-llm`、`dsh-experimental-auto-review`）声明合并。本插件的编译单元不引入这些包，因此 `LlmRequestPurpose` 退化为 `never`、`GenerateOptions['purpose']` 退化为 `undefined`——继续用它会把 `ChatRequestFacts.purpose` 收窄成一个永假的分支类型（tsc 只因 `never | undefined ⊆ string | undefined` 放过，属于静默退化）。

### ④ P1 — `DeepSeekAdapter.stream` 形参变 `GenerateOptions<string>`

- `src/adapter.ts`：`stream(options: GenerateOptions<string>)`、`leased(options: GenerateOptions<string>, stream: (options: GenerateOptions<string>) => AsyncIterable<StreamChunk>)`。
- `src/adapter.ts` `prepareCall` 中 `prepared.stream(scoped)` 需要一次收窄回退：`PreparedAdapterCall.stream` 仍是非泛型的 `GenerateOptions`（即 `GenerateOptions<never>`），而具体实现 `DeepSeekAdapter.stream` 接受 `GenerateOptions<string>`：

```ts
// `PreparedAdapterCall.stream` is not purpose-generic, while this adapter accepts any
// declared purpose; the concrete DeepSeek signature does accept `GenerateOptions<string>`.
return { model: prepared.model, stream: options => this.leased(options, scoped => prepared.stream(scoped as GenerateOptions)) }
```

- `src/chat-adapter.ts`：`stream`、私有 `generate`、私有 `request`、`buildBody`、`toChatMessage` 全部改为 `GenerateOptions<string>`。

为什么：新版 `DeepSeekAdapter.stream(options: GenerateOptions<string>)`，Chat 侧复用它同样的转发语义；统一到 `GenerateOptions<string>` 才能让 `options.purpose` 在编译期保持 `string | undefined`，与 ③ 一致。

### ⑤ P0 — peerDependencies / dependencies / devDependencies

```jsonc
"peerDependencies": {
  "@deepseek-ai/cordis": "~4.1.0",
  "@deepseek-ai/cordis-plugin-loader": "~1.1.0",
  // 其余 20 个 @deepseek-ai/dsh-* 全部 -> "0.2.2-rc.1"
  "react": "^18.2.0"
},
"dependencies": { "@deepseek-ai/schemastery": "~3.19.0" },
"devDependencies": {
  // 与 peer 同版本镜像 + 测试/构建所需
  "@deepseek-ai/cordis": "~4.1.0",
  "@deepseek-ai/cordis-plugin-loader": "~1.1.0",
  "@deepseek-ai/schemastery": "~3.19.0",
  "react": "18.3.1", "react-dom": "18.3.1", "react-test-renderer": "18.3.1", ...
}
```

- 删除 `@deepseek-ai/dsh-invariants`（registry 最高只有 `0.2.0-rc.2`，新版已移除该 peer）。
- 新增两个**仅供测试**的 devDependency（源码不引用）：
  - `@deepseek-ai/dsh-api-remote-access@0.2.2-rc.1`：0.2.2 的 Gateway 以 `inject = ['typert','remoteAccess']` 挂载。
  - `@deepseek-ai/dsh-tool-executor-native@0.2.2-rc.1`：0.2.2 把工具执行从注册表里拆出，组合里必须挂一个 executor。
- `package-lock.json` 重新生成（旧锁固定 0.2.0-rc.2 的完整依赖图，无法增量满足新 peer 集合：`npm install` 直接 ERESOLVE，故删除锁与 `node_modules` 后全新安装）。

### ⑥（顺手优化）`llm/models-updated`

`src/index.ts` 新增监听（`@deepseek-ai/dsh-llm` 0.2.2 新增事件，`types.d.ts` 中 `'llm/models-updated'(provider: string)`）：

```ts
ctx.on('llm/models-updated', provider => {
  if (provider !== INHERIT_SOURCE_ID) return
  try { refresh() } catch (error) { ctx.logger.warn('agent-hint: source refresh failed', error) }
}, { global: true })
```

**原有兜底全部保留**：`loader/volatile-update`、`loader/config-update`、`loader/entry-init`、`internal/status` 轮询与 `refreshQueued` 去重一并未动。新事件只是多一条更窄的触发源（被继承的 `llm-deepseek` 路由自身目录变化），避免因为宿主不 emit 旧信号而漏刷新。

## 二、测试适配（非 ①~⑤，但 `npm run check` 需要）

0.2.2 移除/改写了多个 DSH 内部 API，6 个集成测试文件需要跟着改；**没有放宽任何断言**，只替换了被删除的夹具与新签名：

| 文件 | 旧（0.2.0-rc.2） | 新（0.2.2-rc.1） |
| --- | --- | --- |
| `tests/chat-stream-contract.spec.ts` | `@deepseek-ai/dsh-invariants` + `dsh-llm/invariant` 插件校验流契约 | 该框架整体移除（包已不存在）；断言原样保留，直接对 chunk 与 `BlockAssembler` 校验 |
| `tests/chat-tool-safety.spec.ts` | 同上 + `defineContentToolFixture` | 同上 + `defineTool({ output: { schema, render }, execute })` |
| `tests/chat-host-integration.spec.ts` | `defineContentToolFixture`；`Agents` 先于 `Projections` 挂载；无 executor | `defineTool(...)`；改为先挂 `Projections` 再挂 `Agents`（0.2.2 中 `Agents` 注入 `sessionProjections`，延迟挂载不会再被回溯激活）；挂载 `dsh-tool-executor-native` |
| `tests/gateway.spec.ts` | 只挂 `TypertRegistry` + `TypertGatewayService`；`invoke({namespace,method,args})` | 加挂 `RemoteAccessService`；`invoke` 必须带 `peer`（`new Peer(ctx, { principal: { kind: 'owner' } })`） |
| `tests/loader-composition.spec.ts` | 同上 | 同上（两处 `typertGateway.invoke` 补 `peer`） |
| `tests/client-bundle.spec.ts` | `OperatorPeer` + `connection.rpc.intercept(channel, claim, handler)` | `Peer`（`OperatorPeer` 已删除）；`intercept('/api', matches, handler)`，handler 第 4 参为 `peer`；加挂 `RemoteAccessService` |
| `tests/lifecycle-bridge.spec.ts` | 只有 header 血缘用例 | 新增 5 个用例覆盖 ② 的 `origin` 守卫与启发式（窗口内、窗口外、未 seeded、消费一次、失败压缩不推断） |

## 三、验收结果（本机，Node v24.19.0 / npm 11.17.0）

```
npm ci        -> ok（lockfile 与 package.json 一致，可重现安装）
npm run build -> ok（tsc -b + node scripts/build-client.mjs，lib/ 删除后全新构建，33 个产物）
npm run typecheck -> ok（tsc -b --force，0 error）
npm run check -> ok
  tests: 21 files / 210 tests passed
  Package 0.6.0-rc.8: 50 files, exports, current docs and lock metadata verified
```

`scripts/check-package.mjs` 未改动：其中并没有 LICENSE 断言（只校验 `files` 里的包内资产与文档链接、以及 lock 与 `package.json` 的 dependency/peer/dev/engines 一致性），仓库根目录 `LICENSE`、`NOTICE` 保持原样、仍在 `files` 中。

遗留 `0.2.0-rc.2` 提及：`docs/` 下 4 篇历史记录（`release-correctness-20261029.md`、`stream-contract-20261031.md`、`manual-review-20261026.md`、`path-b.md`）是**历史存档**，按约定不改；`README.md`/`README.en.md` 的当前宿主版本声明已更新为 `0.2.2-rc.1`。`src/`、`package.json` 内已无 `0.2.0-rc.2`。

## 四、遗留风险 / 需人工确认

1. **② 的启发式血缘是推断，不是事实。** DSH 不再提供普通 fork 的父会话，插件只能按「`compaction/end` 之后 60s 内出现的第一个 seeded 会话」归属。已知失效场景：
   - 压缩后用户在窗口内又开了一个普通的 seeded 会话（replay/resume），会被误归属——因此实现里**消费一次**即失效，牺牲第二个会话的准确性换取第一个的正确性；
   - 压缩后 fork 落地超过 60s（大日志压缩、慢上传）则血缘丢失，`parent_session_id` 直接不出现（行为上等于「未知」而非报错）；
   - 同一窗口内发生两次压缩时，只有最后一次观察生效。
   **需人工在真机确认**：协调器（MindIE-Motor）侧是否真的依赖 `parent_session_id` 做缓存复用；若依赖，建议后续把血缘改为「由 fork 调用方显式传入」而不是继续靠时间窗。
2. **`origin === 'subagent'` 的判定依赖 0.2.2 的 header 契约。** TypeScript 层面已通过（`origin?: 'subagent'`），但「普通 fork 不写 `parentSession`」是行为契约，只有真机跑一次 compact/fork 才能确认没有残留写入口（历史 log 仍可能带 `parentSession`，实现已兼容读取）。
3. **浏览器 DOM 契约未在真机验证。** `src/client/` 依赖目标宿主的 composer DOM 标记（`[data-slot="conversation.composer.bar"]` 等）。0.2.2 的 `dsh-client-ui-conversation` 输入域改动很大（`input/editor/runtime.d.ts` 等 55+ 行变更、新增 `CommandChip`/`QuoteNode`/`draft.d.ts`），`composer.spec.ts` 用的是本地 fixture DOM，无法证明真实宿主上仍匹配。**需人工在 0.2.2-rc.1 真机做一次浏览器验收**（挂载、切页、草稿恢复、编辑触发 composing）。
4. **`purpose` 语义变宽后的行为差异。** 现在任何非空 `purpose` 都不注入 hint；0.2.2 新增了目的（如 auto-review、session-title 走 LLM）。若某天某个后台调用需要 hint 注入，本插件会静默跳过——这是既有设计（避免污染 KV 缓存），但语义边界变宽了，值得人工确认是否符合预期。
5. **control 请求仍发空 `messages: []`。** platform fork 为此加了 `padControlMessages`（补一条占位 user 消息）。本仓库测试 `expect(controls.every(r => r.body.messages.length === 0))` 明确要求空数组，故未引入该选项。**如果真实协调器要求非空 messages，这条断言与实现对不上**——`需人工确认` 协调器一侧的校验规则（这属于 platform 的本地适配，不在本次移植范围）。
6. **`@deepseek-ai/dsh-tool-executor-native` / `dsh-api-remote-access` 只作为 devDependency** 出现在测试组合里；真实宿主组合由 DSH 自身的 bundle 决定。若部署方的最小组合里没有 executor，AgentLoop 会以 "The selected tool executor is unavailable" 失败——这是 0.2.2 的组合要求，不是本插件引入的。
7. **`catalogModelFields` / `isBuiltInCatalog`** 等 0.2.2 新增工具函数未使用（本插件用自己的 `catalogModelInfo` 投影）；若后续要跟宿主 catalog 行为完全对齐，可再评估。
8. 未做：`docs/transport.md`、`docs/endpoint-inheritance.md`、`docs/reliability.md` 的正文未随 0.2.2 更新（其中 `endpoint-inheritance.md` 开头仍写「适用 0.6.0-rc.1 / DSH 0.2.0-rc.1」）。它们被 `check-package.mjs` 的链接校验覆盖，内容层面需要产品侧确认是否重写。
