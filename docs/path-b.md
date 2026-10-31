# 路径 B：纯插件补充触发源

本文保留v0.4.0触发源调查和 rc.2 激活触发历史。当前0.6.0-rc.7的顺序、草稿通知、取消和失败策略以[可靠性合同](reliability.md)为准；当前客户端不再在挂载/切页时调用 activated。rc.6 引入的 stock 连接探测、args 封装和 composer DOM 编辑事件继续保留；rc.7 的流协议修复不更改这些触发条件。

本文描述独立协调器控制能力。v0.4.0 起插件只有这一种模式；端点与模型目录从 `llm-deepseek` 路由继承，见 [endpoint-inheritance.md](endpoint-inheritance.md)。

2026-10-21；目标为 npm 发布的 DSH **0.2.0-rc.1**。官方源码 checkout 已到 rc.2，含既有改动，未修改；参考 fork 也未修改。

## 三个未知的结论

| 问题 | 结论与证据 |
| --- | --- |
| 第三方 Remote | 可行。rc.1 Gateway 的 claimsEndpoint/collectSrcClaims/resolveSrcDescriptor 读取活动 Service、typertRemote 与 remoteMethods，没有固定白名单限制。AgentHintSignals 经实际 Gateway 调用，卸载后不可调用。 |
| 草稿观察 | 可行。ui-conversation/client 为 conversation.input.overlay 公开 useInput，InputState 提供 draft。插件贡献返回 null 的组件；React 测试覆盖空白、逐字输入、清空、已有草稿与切会话。 |
| 归档观察 | 可行。WorkspaceRegistry.archiveSession 是可包装公开方法，内部持久化成功后返回。仅新增归档状态通知；保留异常与 receiver。Loader 测试使用真实 Registry 和 Cordis service view，验证归档、stop 和卸载恢复。 |

依据为固定 0.2.0-rc.1 npm 包的 lib/index.js 与 lib/types，package-lock 固定 integrity。上游位置：packages/api/gateway/src/index.ts、packages/typert/protocol/src/index.ts、packages/client/ui-conversation/src/client/contract/slots.ts、packages/workspace/workspace/src/index.ts。行号随版本改变，按具体符号定位。

## 实际路径

当前路径：stock Connection 的 available 探测 → 公共 Slot → composer 内非空编辑事件 → 认证 Connection RPC（args 封装）→ agentHintSignals/composing → 已知且符合条件的 provider 会话 → coordinator resume。挂载/切换/异步恢复草稿静默；监听器挂载前粘贴或目标 DOM 标记缺失时依赖普通请求前恢复。rc.2 的 activated 入口仅为旧客户端兼容保留。只发送 session ID，不传文本；不会创建或恢复 DSH Agent。

公共 archiveSession → 持久化完成 → 新增归档状态 → bridge 去重 → coordinator stop。unarchiveSession 重置周期；官方 session/disposed 保留。对 fork 的原生事件保持兼容，重复来源在 bridge 合并。

## rc.1 数据面修正

原插件调用 registerDeepSeekProvider 并传 prepareExtensions，但实际 rc.1 helper 在展开参数后覆盖此回调。纯函数测试不能发现。现在使用公开 DeepSeekAdapter 与 llm.registerAdapter，保留附件、匿名身份、鉴权、全局扩展链和 retry policy 更新。localhost 抓取断言 start、后续纯身份及后台请求不注入。

## 验证范围

原有 Hint/配置/控制 HTTP 回归；归档成功失败、重复、取消归档、卸载恢复与后装包装保留；React 草稿跃迁；官方 Gateway 动态 Remote、输入过滤及卸载；官方 Loader 组合编译产物、真实 Session/Workspace/LLM/Gateway 和 localhost 数据/控制请求。模型输出与外部持久化介质使用测试替身。

npm 打包、独立安装及 DSH CLI profile 检查的执行记录见 [STANDARDIZATION.md](../STANDARDIZATION.md)。

## 限制

公开方法包装仍是运行时观察：冻结方法时降级，不保证归档 stop。避免多个实例占用同一 provider。后装包装被保留，但无法控制其他插件的卸载行为。只跟踪已使用本 provider 的会话；历史会话未知模型时在真实请求前兜底。

本地测试不代表真实 KV/NPU 或 memcache 性能验收。本任务没有连接或修改 node153。物理预取完成、消费和收益仍需独立引擎实验。
