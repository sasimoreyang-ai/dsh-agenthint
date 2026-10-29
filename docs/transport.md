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

工具id/name/arguments允许分片，直到终止时确认身份与JSON完整后才提供可执行tool-call delta。长度截断不能执行不完整工具。单个SSE行/事件限制4MiB。

usage 区分未缓存输入与缓存读入。`prompt_tokens` 与 `completion_tokens` 必须都存在且为非负安全整数才发布完整 TokenUsage；空对象、缺失或 null 计数不补零，也不覆盖此前完整样本。未提供完整样本时正常回答仍可结束，但不输出 usage chunk。显式的零是合法测量值。已提供的无效计数拒绝；cached 不能大于 prompt，reasoning 不能大于 completion，若 total 提供则必须等于 prompt+completion（Chat 口径，reasoning 属于 completion）。这些校验不推测后端没有测量的值。

响应读取、Hint和凭据等待服从signal及配置的流空闲超时。消费者退出会取消响应体。在消费者暂停取数据期间不计入provider idle time。

HTTP鉴权、限流、额度、服务器、超窗与请求错误按宿主代码分类，保留status、request id和Retry-After；providerRetryPolicy供宿主可选重试插件消费。

## 验收边界

本地stock AgentLoop/Tools与压力压缩集成通过不等于真实模型合格。真实文本/工具任务、后端KV动作与消费、异常恢复、输出质量和性能各自需要证据。参见[可靠性合同](reliability.md)与[验证记录](../STANDARDIZATION.md)。
