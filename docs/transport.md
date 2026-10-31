# Chat 与 Messages 传输合同

0.6.0-rc.1默认Chat。选用哪条协议应由目标后端的字段转发与控制支持决定，不能只靠搜索一个字段名判断全部链路正确。

## 端点

Chat的数据和控制共用URL规范化：根地址补`/v1/chat/completions`，已有`/v1`不重复。Messages使用官方适配器的数据面，控制仍走Chat入口。

历史原厂镜像的Messages入口曾丢弃agent_hint，而Chat入口可保存该字段；这是v0.5.x默认切换的依据。它不意味着所有版本镜像都有相同行为，当前候选需在目标镜像上重新验证。

## 消息投影

Chat保留system/developer/user/assistant/tool角色；tool结果发送tool_call_id，assistant调用发送相应id/name/arguments。assistant reasoning历史映射为reasoning_content。当前工具完整声明每次发送；历史tool-addition/removal标记按不支持原生工具更新的合同移除，developer文字指令保留。

Chat声明文本能力。未由宿主转换的原生图片/文件与未知内容明确报UNSUPPORTED_CONTENT；不会静默变成空输入。Messages附件能力依赖官方实现。Chat不执行Messages专用扩展注册表的prepare回调；通用LLM waterfall仍由宿主执行。

## 流

支持LF/CRLF/CR、跨字节与多行data。DONE结束流并取消剩余body。存在合法finish_reason的完整EOF可结束；缺失finish、非法JSON、未结束事件、流内error均不能报告正常stop。空正常答案报EMPTY_RESPONSE。content_filter报REFUSAL，未知finish reason报MALFORMED_RESPONSE。

工具 id/name/arguments 允许分片。rc.7 在真实 tool ID 可用后立即交付暂态 tool-call-delta；名称按累计值更新，参数按未交付片段递增，避免把纯工具请求的首 token 一律延迟到终态。若 ID 尚未到达，暂存其片段，不伪造 ID。暂态增量不授权执行：所有并行调用身份与完整 JSON 在正常终态前统一校验，失败不完成任何工具块。无参数的正常调用保留 `{}` 默认值。

正常终态前，每个已打开的 text/reasoning/tool-call 块均发送携带累计内容的 block-end，再输出 usage/finish，兼容 DSH 官方 llm/invariant。length 终态可关闭原始截断块，保留不完整内容而不补造身份/JSON；stock BlockAssembler 在 max-tokens 下丢弃所有工具块，AgentLoop 不执行它们。错误/取消保留失败终态，不把残缺工具转成成功调用。直接消费原始适配器流的调用方也必须等终态校验后才能执行工具。单个 SSE 行/事件限制4MiB。

DSH 首 token 是宿主收到有效 text/reasoning/tool 增量的时间，不等于精确 HTTP TTFT。身份元数据不足、宿主屏障、调度和解析仍会带来差异；算法性能评测应独立记录 HTTP 首有效增量与 E2E，不能把本地时序测试当成真实收益。详见[rc.7说明](stream-contract-20261031.md)。

usage 区分未缓存输入与缓存读入。`prompt_tokens` 与 `completion_tokens` 必须都存在且为非负安全整数才发布完整 TokenUsage；空对象、缺失或 null 计数不补零，也不覆盖此前完整样本。未提供完整样本时正常回答仍可结束，但不输出 usage chunk。显式的零是合法测量值。已提供的无效计数拒绝；cached 不能大于 prompt，reasoning 不能大于 completion，若 total 提供则必须等于 prompt+completion（Chat 口径，reasoning 属于 completion）。这些校验不推测后端没有测量的值。

响应读取、Hint和凭据等待服从signal及配置的流空闲超时。消费者退出会取消响应体。在消费者暂停取数据期间不计入provider idle time。

HTTP鉴权、限流、额度、服务器、超窗与请求错误按宿主代码分类，保留status、request id和Retry-After；providerRetryPolicy供宿主可选重试插件消费。

## 验收边界

本地stock AgentLoop/Tools与压力压缩集成通过不等于真实模型合格。真实文本/工具任务、后端KV动作与消费、异常恢复、输出质量和性能各自需要证据。参见[可靠性合同](reliability.md)与[验证记录](../STANDARDIZATION.md)。
