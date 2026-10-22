# v0.5.5审查项闭环记录

候选：0.6.0-rc.1。基线：43bac64。编号对应2026-10-22的17组问题报告。

| 编号 | 本候选处理 | 主要验收 |
| --- | --- | --- |
| F01 角色/工具结果 | 保留角色与tool_call_id，reasoning回放；完整工具声明 | chat-reliability、真实AgentLoop两步工具集成 |
| F02 模型容量/压缩 | 提供context、defaultMaxTokens与正确thinking默认 | 真实TokenMeter/BasicCompaction压力自动摘要与compact事件 |
| F03 不完整流误成功 | 异常EOF、非法JSON、error事件拒绝；终止原因显式分类 | chat-reliability故障输入 |
| F04 后台误记账 | purpose调用不提交普通状态 | 默认Chat的标题/普通请求交错 |
| F05 mutation屏障 | 等最新队列，完整流lease，未知mutation隔离，禁止自动重试 | reliability队列/并发；Messages prepared入口 |
| F06 卸载重试 | lifetime signal取消解析、退避、fetch与队列 | reliability卸载后无新请求；关闭控制面时数据请求也取消 |
| F07 端点/凭据代混用 | 凭据从prepared connection解析，不重新读当前端点配置 | A→B更新中保持A+A快照 |
| F08 源热更新 | 逐次读取有效源引用，监听全局/源生命周期刷新目录 | Loader源更新/删除/禁用/重加 |
| F09 继承默认值/参数 | 源schema默认目录与有效参数；同端点凭据引用可继承/退出 | Loader与HTTP字段断言、default目录 |
| F10 显式默认被覆盖 | 保留未配置状态，尊重localhost及models空数组 | config/inherited-connection与Loader显式覆盖 |
| F11 URL/model路由 | 共用/v1规范化；使用真实请求model | 默认Chat选非首项模型与/v1路径 |
| F12 resume恢复 | 类型化结果，明确失败冷却后恢复，迟到失败按attempt身份处理 | reliability失败恢复/普通请求开始后返回 |
| F13 SSE/工具分片 | 标准行结束、多行/跨字节、DONE结束、工具字段累积验证 | chat-reliability协议矩阵与BlockAssembler |
| F14 取消/超时 | 响应body取消，空闲watchdog，Hint/凭据有界等待 | 取消、退出迭代器、无数据、解析卡住 |
| F15 错误分类/重试策略 | 宿主错误代码、status/Retry-After、providerRetryPolicy | HTTP429/503/超窗与配置策略 |
| F16 静默丢内容 | Chat文本能力；不支持的原生内容明确失败 | image/file/未知block拒绝，未新增原生多模态实现 |
| F17 发行卫生 | 版本与锁对齐，移除inherit产物，打包全部文档与链接检查 | check-package、npm pack、CLI profile安装 |

## 没有越级承诺的部分

F05修复的是插件客户端顺序，不提供后端异步完成、幂等性或跨实例fencing。未知状态不跨插件重启持久化，详见[可靠性合同](reliability.md)。

F16通过明确能力与拒绝语义消除静默数据丢失，没有把Chat改造成原生图片/文件适配器。真实宿主的附件文本句柄与Messages已有能力仍按对应合同工作。

本地模型HTTP为fixture；真实工具执行和自动压缩消费端是真实官方实现。真实模型输出质量、153的Hint/KV动作与消费、稳定性和性能仍需对当前候选独立验收。无服务器变更记录。
