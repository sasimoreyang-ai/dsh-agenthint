# rc.7：Chat 流协议与工具首 token 修复

日期：2026-10-31。基线 rc.6 `0e98b04`，分支 `fix/main-release-correctness-20261029`，目标 DSH `0.2.0-rc.2`。

## 触发与修复

1. rc.6 发出 block-start 后没有 block-end，启用官方 LLM invariant 时，合法回答会报仍有打开的内容块。rc.7 为文本、推理、工具块提供累计内容的 block-end，在正常 usage/finish 前关闭全部块。
2. rc.6 将工具片段缓冲到流结束才输出 tool-call-delta，纯工具请求的 DSH 首 token 因而可能接近请求结束。rc.7 在 ID 可用后立即输出名称和参数片段；名称是累计值，参数只发送新增部分。ID 未到达时暂存，不伪造身份。终态的完整块不重复累计 delta。

## 执行安全性

暂态工具片段不等于可执行调用。所有并行调用都要在正常 tool-calls 终态前完成非空身份、唯一 ID 与完整 JSON 校验；其中任一个无效时，不完成任何工具块，不产生成功 finish。真正的默认无参数调用仍使用 `{}`。

length 终态关闭原始部分块，不补造身份或完成 JSON；DSH BlockAssembler 按 max-tokens 丢弃工具块，AgentLoop 也不会进入工具执行。错误和取消允许保留打开块到失败终态，按官方 invariant 的错误路径处理。

直接消费公开原始 stream 的集成方必须等待完整有效终态再执行工具，不能收到 tool-call-delta 就执行。这与 stock DSH AgentLoop 的执行规则一致；此前依赖“delta 一定已经完整”的外部消费者需要迁移。

## 验证与指标边界

标准回归增加官方 InvariantRegistry + llm/invariant + LlmRuntime 组合测试，覆盖文本/推理/并行分片工具、无参数、length、非法 JSON/身份、重复 ID、取消。门控响应测试在终帧尚未发送时断言 DSH 已收到首工具 token，避免用易抖动的定时阈值充当通过条件。

真实 AgentLoop/Tools 组合测试在暂态增量已经可见时检查执行数仍为零；有效终态后只执行一次，畸形、重复 ID、length、流错误和取消后均不执行。

DSH 首 token 仍包含宿主与适配器开销，也可能等待必要的工具 ID，不承诺等于 HTTP 到达时间。真实性能实验应分别采集 HTTP TTFT、DSH 首次可观测输出与请求 E2E。模型响应仅为本地 fixture；没有由此证明真实 KV 预取或性能收益。实际执行结果见 [验证记录](../STANDARDIZATION.md)。

## 安装与回退

按 README 从固定审核提交或 rc.7 tarball 安装，重启自己的 DSH 实例。回退使用已保留的 rc.6 包/固定提交，再重启对应实例；共享服务器升级或重启仍需核查目标和当次授权。未修改引擎、Hint 触发或控制屏障。
