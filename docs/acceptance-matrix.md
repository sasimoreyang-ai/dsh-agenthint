# 验收矩阵 C01–C17

主方案 §10.1 的十七项行为验收，逐项给出对应测试与实测结果。

- 运行命令：`npx vitest run`
- 环境：Windows 11 / Node 24.19.0 / vitest 4
- 结果：**17 个测试文件，175 项全部通过**
- 测试数只作附属信息；下表以**行为**为准

---

## C01 仓外 consumer 只安装 Core

| 项 | 内容 |
|---|---|
| 预期 | import / typecheck 成功；没有 DSH / React / Cordis 依赖 |
| 测试 | `packages/agenthint-core/tests/core.spec.ts` 全文只导入本包 |
| 实测 | 打包 16 个文件、16.4 KB、零依赖；装进仓外空目录 `added 1 package`（零传递依赖）；`node consumer.mjs` 输出首请求带 `start`、次请求不带、后台为 `undefined`、控制发出 `pause` |
| 结论 | **PASS** |

## C02 新会话首次/第二次请求；seeded 会话

| 项 | 内容 |
|---|---|
| 预期 | `start` 时机保持合同；后台不消耗首次状态 |
| 测试 | `core.spec.ts` → "consumes start only after the request is accepted"、"never re-declares start for a seeded session"、"leaves background calls out of the ordinary bookkeeping" |
| 结论 | **PASS** |

## C03 无 session、非法 Hint / cache policy

| 项 | 内容 |
|---|---|
| 预期 | 不造身份；非法数据明确拒绝 |
| 测试 | `core.spec.ts` → "never invents an identity for an anonymous request"、"rejects a cache policy that names no type" |
| 结论 | **PASS** |

## C04 普通与标题/摘要交错

| 项 | 内容 |
|---|---|
| 预期 | 后台不发 Hint、不触发 lifecycle 记账 |
| 测试 | `core.spec.ts` → "leaves background calls out of the ordinary bookkeeping"、"does not block background calls behind an unaccepted first request"；`agent-hint.spec.ts`（11 项） |
| 结论 | **PASS** |

## C05 流未结束时 compact / stop

| 项 | 内容 |
|---|---|
| 预期 | mutation 等待；没有 request/control 竞态 |
| 测试 | `core.spec.ts` → "holds a mutation until the model stream finishes"；`reliability.spec.ts` → "waits for all active streams before dispatching a queued mutation" |
| 结论 | **PASS** |

## C06 屏障等待期间追加 mutation

| 项 | 内容 |
|---|---|
| 预期 | 等最新队列；不能只等旧尾巴 |
| 测试 | `core.spec.ts` → "waits for the latest queued mutation rather than the first one" |
| 结论 | **PASS** |

## C07 mutation 超时、网络中断、派发后取消

| 项 | 内容 |
|---|---|
| 预期 | unknown / 隔离；后续普通请求 `CONTROL_BARRIER` |
| 测试 | `core.spec.ts` → "reports a CONTROL_BARRIER after an unknown mutating outcome"、"never retries a mutating verb that answered 503"；`lifecycle-bridge.spec.ts` → "fails open when the barrier cap expires first" |
| 结论 | **PASS** |

## C08 resume 明确临时拒绝、迟到失败

| 项 | 内容 |
|---|---|
| 预期 | 有界重试、冷却恢复；不被 generation 错误吞掉 |
| 测试 | `core.spec.ts` → "retries only an explicit transient rejection"、"re-arms the resume guard after a failed prefetch"；`control-client.spec.ts` → "retries resume after an explicit transient rejection"、"gives up after the configured retries" |
| 结论 | **PASS** |

## C09 插件卸载或解析凭据卡住

| 项 | 内容 |
|---|---|
| 预期 | 有界取消；卸载后没有新控制请求 |
| 测试 | `core.spec.ts` → "cancels queued work and stops sending once disposed"；`reliability.spec.ts` → "cancels credential resolution without sending a request later"、"bounds a stalled connection resolver" |
| 结论 | **PASS** |

## C10 A→B 配置更新中正在准备请求

| 项 | 内容 |
|---|---|
| 预期 | endpoint/key/route 快照不混代；控制不跨 origin 泄漏密钥 |
| 测试 | `control-client.spec.ts` → "keeps one endpoint/key snapshot across retries and refreshes it for the next operation"、"omits the authorization header when no credential resolves"；`loader-integration.spec.ts` → "refuses to send model credentials to a different control origin" |
| 结论 | **PASS** |

## C11 两用户相同 local session ID、并行宿主 scope

| 项 | 内容 |
|---|---|
| 预期 | 内外身份不串；B 活动不暂停 A |
| 测试 | `core.spec.ts` → "keeps two coordinators independent so one scope cannot pause another" |
| 结论 | **PASS**（结构性隔离；后端 KV 分区仍需后端合同，见 §备注） |

## C12 同会话重叠首次请求、子 Agent / 分支

| 项 | 内容 |
|---|---|
| 预期 | 明确拒绝或隔离，不能重复 start / 错误共享 |
| 测试 | `core.spec.ts` → "rejects a second overlapping preparation before start is declared"、"does not block background calls behind an unaccepted first request" |
| 结论 | **PASS** |

## C13 请求已 prepare 但没有启动、流异常退出

| 项 | 内容 |
|---|---|
| 预期 | lease 有释放机制，不永久阻塞控制 |
| 测试 | `core.spec.ts` → "releases the stream slot when a prepared request never starts"、"makes finish idempotent so a double release cannot corrupt the queue" |
| 结论 | **PASS** |

## C14 真实 DSH AgentLoop 工具闭环与 BasicCompaction

| 项 | 内容 |
|---|---|
| 预期 | 工具关联、角色、摘要提交、compact 消费均保持 |
| 测试 | `loader-integration.spec.ts`（6 项，真实 Loader 与配置继承）、`chat-host-integration.spec.ts`（4 项）、`loader-composition.spec.ts` |
| 真机 | 0.6.0-rc.1 拆分版通过 `dsh plugin add` 装入 verify-hl，headless 工具任务正常完成；引擎侧出现 `session_control.type=start`、会话注册非 `None`、块分配正常 |
| 结论 | **PASS** |

## C15 两个入口都覆盖完整生命周期

| 项 | 内容 |
|---|---|
| 预期 | `prepareCall()` 与 `stream()` 两入口都持有完整 lease，不能仅一个通过 |
| 测试 | `reliability.spec.ts` → `AgentHintAdapter.prepareCall` 取流后释放；`chat-reliability.spec.ts` → 两处 `prepareCall` 路径 |
| 结论 | **PASS** |

## C16 SSE 分片/异常 EOF/不支持图片文件

| 项 | 内容 |
|---|---|
| 预期 | 保持既有错误与取消合同，无静默内容丢失 |
| 测试 | `chat-adapter.spec.ts`（7 项：分块翻译、`reasoning` 字段名、`tool_calls`、`EMPTY_RESPONSE`、content 恒在）、`chat-reliability.spec.ts`（27 项） |
| 结论 | **PASS** |

## C17 未知状态下重启后恢复旧会话

| 项 | 内容 |
|---|---|
| 预期 | 进入明确恢复门槛；不能只靠重启清隔离 |
| 测试 | `core.spec.ts` → "keeps a quarantined session quarantined after re-registration" |
| 覆盖范围 | 证明**重新注册不会清除隔离**（这是重启恢复的核心语义） |
| 未覆盖 | 真实进程重启后的状态恢复流程 |
| 结论 | **PARTIAL** |

---

## 备注与未执行项

| # | 项 | 状态 |
|---|---|---|
| 1 | C17 的真实进程重启恢复 | **NOT-RUN**。当前隔离在内存中；单写者部署约束下未实现持久化恢复日志。属方案 §6.4 的后续独立项目 |
| 2 | 跨租户后端 KV 分区（C11 的后端部分） | **NOT-RUN**。需要后端提供可测试的分区合同；SDK 内部隔离不等于后端隔离 |
| 3 | Platform 安装与路由验收 P01–P12 | **BLOCKED**。见 `docs/integration-baseline.md` |
| 4 | 性能收益验证 | **NOT-RUN**。本轮不做收益声明 |

---

## 复现

```bash
npm ci
npm run check          # typecheck + 175 tests + 包完整性
npx vitest run         # 仅测试
```

仓外 Core 验证：

```bash
cd packages/agenthint-core && npm pack
mkdir /tmp/consumer && cd /tmp/consumer && npm init -y
npm install <path>/sasimoreyang-ai-agenthint-core-0.6.0-rc.1.tgz
node -e "import('@sasimoreyang-ai/agenthint-core').then(m=>console.log(Object.keys(m)))"
```
