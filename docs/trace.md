# Hint trace

默认开启独立的、按会话查询的适配器 trace。服务端标准输出打印带 `agent-hint/trace` 前缀的 JSON 日志，可用 `docker logs` 或服务日志采集器读取，不依赖 DSH 框架的 info 日志级别；Web 会话栏提供「下载 Hint trace」，通过现有认证 Connection/RPC 下载当前会话的 `agent-hint-trace.json`。下载是只读操作，不发送模型请求或生命周期控制。没有 Gateway 或旧宿主没有该能力时，不显示按钮；生命周期控制关闭时，普通请求的 trace 和下载仍可工作。

trace **不写入原 Session 日志，也不改变原 Session ZIP**。当前 SDK 的 `Session.append` 不开放外部事件的 `ignorable` 标记，直接写入自定义事件可能使会话无法重新打开。单独下载避免污染会话历史和模型输入。

在 Web profile 的 `cordis.patch.yml` 中配置，重启后生效；不要把静态 `agentHint` 选项放进旧版 `.dsh/settings.yaml`：

```yaml
- id: llm-agent-hint
  config:
    agentHint:
      trace:
        enabled: true
        maxRecords: 2000
```

`enabled: false` 同时关闭服务端 trace、内存窗口和 Web 下载能力，不关闭 Hint 本身。`maxRecords` 范围 1–10000，是整个插件实例的记录总数上限，所有会话共享。窗口只保存在当前进程内，重启/插件重载清空；超限淘汰最旧记录，包括仍在进行中的请求的早期记录。下载中的 `droppedRecords` 是整个窗口累计淘汰数，不是该会话的丢失数。长期留存请保留服务端日志，下载不能补回之前未记录或已淘汰的事件。

每条记录包含 `requestId`、会话 ID、模型、数据/控制平面、协议、阶段、时间和白名单 Hint 字段。`requestId` 只用于插件内部关联，不自动透传到引擎；引擎侧用会话 ID 和时间交叉核对。`start` 随普通请求记录，`pause/resume/stop/compact` 独立记录；同一次控制调用的重试共享 `requestId`，以 `attempt` 区分。身份请求只有 `session_id`，没有控制动词。后台用途或其他未携带 Hint 的请求不产生 Hint trace。

- Chat：`prepared` 是请求体准备完成；`dispatch/dispatching` 是即将调用 `fetch`，不证明引擎收到。普通请求的 `accepted` 表示收到 2xx 响应头，控制请求则还要求响应体读取结束；`httpStatus` 和 `durationMs` 记录该边界的状态及耗时。它们不是首 token 延迟、生成成功、KV 恢复完成或加速收益。
- 控制请求：记录 `rejected`、`unknown`、`cancelled` 或 `not-dispatched`；缓存修改请求的暂时性 HTTP 错误仍为 `unknown`。`dispatched: false` 区分未发出与发出后取消。网络超时不伪造 HTTP 状态。
- Messages：官方扩展接口只提供准备与 2xx 后接受回调，因此仅记录 `prepared` 和可确认的 `accepted`，不虚构发送事件、HTTP 状态或失败原因。仅有 `prepared` 的记录不能证明请求发出；`durationMs` 从准备开始计算，不能与 Chat 的发送耗时直接比较。

记录不包含 API Key、请求头、完整 URL、对话、工具参数、响应正文或原始错误；`cache_control` 只保留 `type`，其他自定义字段不导出。标识字符串最多保留 512 字符。诊断输出不改变 Hint 协议、重试策略或生命周期结果；日志输出失败不影响推理。
