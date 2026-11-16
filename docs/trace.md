# Hint trace

默认开启独立的、按会话查询的适配器 trace。记录**同时**落到两处：

1. **DSH 会话日志**（`session.v4.jsonl`，与 `turn/start`、消息等会话事件放在同一个文件里），使用 DSH 0.2.2-rc.1 新增的 `appendPluginRecord` 通道，一条 attempt 只写一条终态记录；
2. **服务端标准输出**，带 `agent-hint/trace` 前缀的 JSON 日志，可用 `docker logs` 或服务日志采集器读取，不依赖 DSH 框架的 info 日志级别；每条记录（含 `prepared`/`dispatch` 中间态）都会打印。

## 为什么现在可以写入会话日志

旧 SDK 的 `Session.append` 不开放外部事件的 `ignorable` 标记，直接写自定义事件可能让会话无法重新打开；DSH 0.2.2-rc.1 引入 `appendPluginRecord` 后，终态记录已能安全写入会话日志。

DSH 0.2.2-rc.1 提供了官方实验通道 `appendPluginRecord(session, type, data)`，语义正好对症：

- 记录是标记 `ignorable: true` 的事件，**不认识的 reader 会保留并跳过**它，不会拒绝重建会话；
- 记录**不进入模型可见 surface**（没有 `surfaceOp`/`sourceEventSeqs`，`session.surface.nodes` 与 `deriveMessages()` 都不受影响）；
- fork / resume 会随日志携带这些记录；
- 本插件只写不读：需要证据时直接从 `session.v4.jsonl` 取记录，不再提供读回通道。

记录类型名带本包前缀（`plugin:mindagent-dsh-llm-agent-hint/trace`），不会与其他插件撞名。`PluginRecordMap` 是声明合并点，未在此登记的 key 会被 `appendPluginRecord` 的类型直接拒绝。

### 已知取舍：使用了上游限定范围的 API

`appendPluginRecord` 的文档写明「Only production source under `packages/experimental/` may call this」。这是 DSH 仓库**对自己的发布流程**做的政策约定（由该仓库的 `verify-plugin-record-callers` 门禁检查其自有源码），**不是运行时检查**：本插件调用时不会被拒绝、不会降级。我们已知情并决定使用，理由是这个通道是当前唯一能让记录与会话事件同处的官方通道。

升级宿主版本时必须重新确认三件事：该函数仍然存在；PluginRecordMap 声明合并点与记录名语法（plugin: + 小写斜杠分段）未被改动；不认识的 ignorable 记录仍然「保留并跳过」而不是拒绝加载会话。任一条件不成立时应把 gentHint.trace.writeToSession 设为 alse，回退到「只写 stdout」。

## 配置

在 Web profile 的 `cordis.patch.yml` 中配置，重启后生效；不要把静态 `agentHint` 选项放进旧版 `.dsh/settings.yaml`：

```yaml
- id: llm-agent-hint
  config:
    agentHint:
      trace:
        enabled: true
        maxRecords: 2000
        writeToSession: true   # 默认 true；false 时只写 stdout 与进程内窗口
```

- `enabled: false` 同时关闭服务端 trace、内存窗口与会话日志写入，不关闭 Hint 本身。
- `writeToSession: false` 只关闭会话日志写入，stdout 与进程内窗口保持原样。怀疑宿主 plugin record 语义变化、或不想让会话文件变大时使用。
- `maxRecords` 范围 1–10000，是整个插件实例内存窗口的记录总数上限，所有会话共享；窗口超限淘汰最旧记录，包括仍在进行中的请求的早期记录。
- 会话日志写入**复用了同一个 `maxRecords` 作为节流依据**：每个会话在每个插件实例内最多写入 `maxRecords` 条终态记录，达到上限后该会话后续记录只写 stdout（首次跳过会记一条 warn）。这是内存窗口上限的镜像，避免长会话把日志写成无界。
- 崩溃/重启前的记录只要已经进入会话日志，就仍在 `session.v4.jsonl` 里，可直接从会话日志读取；未写入的部分无法补回。

## 记录内容与写入时机

每条记录包含 `requestId`、会话 ID、模型、数据/控制平面、协议、阶段、时间和白名单 Hint 字段。`requestId` 只用于插件内部关联，不自动透传到引擎；引擎侧用会话 ID 和时间交叉核对。`start` 随普通请求记录，`pause/resume/stop/compact` 独立记录；同一次控制调用的重试共享 `requestId`，以 `attempt` 区分。身份请求只有 `session_id`，没有控制动词。后台用途或其他未携带 Hint 的请求不产生 Hint trace。

**会话日志只收终态**：每次 attempt 仅在 `phase: 'result'` 时写入一条；`prepared` / `dispatch` 中间态只留在进程内与 stdout，避免会话文件按 3 倍膨胀。stdout 行为不变，每条都打印。

- Chat：`prepared` 是请求体准备完成；`dispatch/dispatching` 是即将调用 `fetch`，不证明引擎收到。普通请求的 `accepted` 表示收到 2xx 响应头，控制请求则还要求响应体读取结束；`httpStatus` 和 `durationMs` 记录该边界的状态及耗时。它们不是首 token 延迟、生成成功、KV 恢复完成或加速收益。
- 控制请求：记录 `rejected`、`unknown`、`cancelled` 或 `not-dispatched`；缓存修改请求的暂时性 HTTP 错误仍为 `unknown`。`dispatched: false` 区分未发出与发出后取消。网络超时不伪造 HTTP 状态。
- Messages：官方扩展接口只提供准备与 2xx 后接受回调，因此仅记录 `prepared` 和可确认的 `accepted`，不虚构发送事件、HTTP 状态或失败原因。仅有 `prepared` 的记录不能证明请求发出；`durationMs` 从准备开始计算，不能与 Chat 的发送耗时直接比较。

记录不包含 API Key、请求头、完整 URL、对话、工具参数、响应正文或原始错误；`cache_control` 只保留 `type`，其他自定义字段不导出。标识字符串最多保留 512 字符。诊断输出不改变 Hint 协议、重试策略或生命周期结果。

## 写入失败与旧宿主的降级

写入会话日志是纯诊断动作，**任何失败都不影响推理**：

- 没有 `sessions` 服务、该会话不在本进程的 Session store 中、或宿主没有导出 `appendPluginRecord`（旧宿主）时，自动跳过会话日志写入，不报错、不 warn；
- `appendPluginRecord` 抛错（例如会话尚未完成 `session/created` 通告、数据不可 JSON 序列化、或它自身的写入校验失败）时，捕获后降级为「只写 stdout」，同一会话只 warn 一次；
- 达到 `maxRecords` 预算时跳过并 warn 一次。
