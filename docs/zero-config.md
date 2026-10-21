# v0.2.0：复用现有模型的 AgentHint 安装方案

日期：2026-10-21；宿主基线：npm DSH 0.2.0-rc.1。

## 本次需求与验收

用户最新要求是“装上插件就能发出 hint，不要自己配置模型”。实现选择默认继承现有 DeepSeek Messages 请求，而不再要求用户添加第二个 provider。原模型的首次配置不属于插件可以省略的前提。

| 验收项 | 实现/证据 |
| --- | --- |
| 安装 patch 不包含模型、地址或凭据 | cordis.patch.yml 只指定 mode: inherit |
| 不新增 provider、不改变模型列表 | tests/inherit.spec.ts 比较安装前后的官方 provider 和模型目录 |
| 原始 HTTP 请求携带 Hint | 同一测试使用公开 Loader 和 API-key 适配器，实际访问本地 HTTP fixture |
| 原认证和模型继续生效 | 检查 x-api-key、body.model、messages 与原请求一致 |
| 更新原地址/凭据继续生效 | 更新官方 provider 配置后捕获新 URL 与新凭据，无插件配置更新 |
| 历史/fork、失败重试、辅助请求 | 核验不重复 start、parent_session_id、400 后重新 start、压缩/标题无 Hint |
| 可关闭、可卸载 | agentHint.enabled=false 与移除 Loader 条目均停止字段注入 |
| 无独立控制目的地猜测 | inherit 不创建 SessionControlClient、不挂载归档观察器或控制 Remote |

默认模式覆盖官方扩展注册表的消费者，不包含 llm-pi-ai 的所有协议。请求线上包含 Hint 的本地集成事实，不证明远端服务接受字段、真实 KV 行为或性能收益。

## 对补充文档五个未知的答复

### 1. 设置页的值在哪里，是否需要另做 settings 合并？

rc.1 的设置并非一份与 Cordis 配置隔离、需要插件手动同步的模型数据库。

源码链路：

1. `node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`：`createModelsOperations.writeSettings` 调用 `remote.settings.mutate`；`storeCredential` 单独调用 `remote.credentials.set`。
2. `node_modules/@deepseek-ai/dsh-settings/lib/index.js`：`SettingsForms.mutate` → `write`，经 `configEditor.edit` 修改对应 namespace 的活动条目，校验 volatile 字段及 revision。
3. `node_modules/@deepseek-ai/dsh-config-editor/lib/index.js`：`ConfigEditor.edit` 合成当前 profile patch，原子持久化并调用 `reconcileProfilePatches`，失败时回滚。
4. `node_modules/@deepseek-ai/dsh-llm-deepseek-api-key/lib/index.js`：`plainOptions` 用 `.get()` 读取动态配置；`resolveApiKey` 经 credentials 解析引用。

因此 standalone 已有 `plainOptions(config)` 路径能够读取经官方设置链路提交的 volatile 变更。不要新增一份手工 settings 合并，否则易产生优先级冲突。有效配置层次由 ConfigEditor/Loader 负责；凭据内容与 apiKeyEnv 引用分开管理。本次 inherit 更直接：不读取或复制认证配置，完全复用原适配器。

### 2. settingsPath: [] 对吗，第二条路由会不会冲突？

对于“一条插件 entry 的整个 config 就是一份 profile”，空路径正确。namespace 是 entry ID，而不是任意显示名称。第二个 standalone 实例必须有不同 entry ID、不同 provider；仅改变显示名不能避免注册冲突。当前浏览器控制 Remote 还是单一服务，不能据此宣称多 standalone 控制实例已支持。inherit 只需一个实例，不注册配置 provider，也不需要第二条模型路由。

证据：`src/index.ts` 的 `registerConfigurableProviders`；`dsh-llm/lib/types/types.d.ts` 的 `LlmConfigurableProvider`；`dsh-llm/lib/index.js` 的目录/adapter 注册冲突检查。

### 3. declared: true 是否足以让设置页支持任意第三方插件？

不能。它描述配置声明的路由，不是自动生成任意插件模型表单的开关。独立协调器路由声明该字段语义合理，本次已补充；但不能据此宣称“添加服务商”完整流程已修好。

关键限制在 `dsh-client-ui-settings-models/lib/client.js` 的 `layoutOf`：只识别 `llm-deepseek` 和 `llm-pi-ai` namespace，其余为 `unknown`；`curatedFields` 的身份编辑分支还要求 `family === 'pi-ai' && declared === true`。添加服务商的预置 namespace 也是 `llm-pi-ai`。只补 declared 和 discovery 回调不足以解决原文提出的界面体验。

本次通过默认继承模式直接移除“必须另添加 AgentHint 服务商”这一步，不修改宿主 UI 的私有分支。

### 4. 发现结果要不要持久化？

`LlmRuntime.discoverModels` 明确只对草稿端点进行发现，不读写 settings/credentials；界面先把候选模型选入表单草稿，再由用户保存配置。不能把发现成功等同于配置已持久化，也没有理由在本插件引入另一套 TTL 模型缓存。

证据：`dsh-llm/lib/types/index.d.ts` 的 `discoverModels` 合同；`dsh-client-ui-settings-models/lib/client.js` 的 `ModelCatalog` / 候选选择 / `createModelsOperations.writeSettings`。本次 inherit 不需要额外模型发现；原目录和原设置继续由宿主管理。standalone 未新增发现 API，不宣称其模型发现 UI 已完成。

### 5. 是否自动改默认模型？

默认模式不新增模型，所以无需切换默认模型，也不覆盖已保存选择。`dsh-base/cordis.patch.yml` 的 `agent-default-model` 仍由宿主管理。现有模型没有凭据时，安装插件仍不能让它成功推理；这种情况下应先完成原 DSH 模型接入。

升级旧 standalone 配置属于迁移：继续完整控制需明确 `mode: standalone`；选择继承模式时需撤销旧独立路由覆盖，使用原有可用 provider。插件不静默重写历史会话路由。

## 实现边界与后续宿主接口

`DeepSeekLlmApiExtensionRequest` 只包含 body/sessionId/purpose/signal，见 `dsh-deepseek-llm-api-extensions/lib/types/types.d.ts`。没有 URL、credential、provider，因此无法可靠地从该回调恢复同一请求的控制连接。

若下一步要求“继承任意已有模型，并自动完成全部独立生命周期控制”，建议宿主公开安全的 route-scoped control sender 或带连接代际的请求上下文。凭据应留在宿主发送器内部；同一会话切换 provider 时，旧控制操作与新连接必须隔离。这是后续合同工作，本版本不以猜地址或读取私有 adapter 字段代替。

## 同时修复的审查问题

- standalone 的控制请求原来捕获旧 endpoint、动态读取新 key；改为每个操作获取成对连接快照，并在该操作的重试中固定快照。
- pause/stop 原来未参与等待，resume 可能越过旧操作；改为每个会话的控制队列。等待仍有上限；超时不等于服务端已停止。
- archive/unarchive 原来在排队前读取 before；现在把 before/调用/after 放到同一个观察器队列，失败不阻塞后续操作。
- 重开同 ID 会话使用新的状态对象，旧 stop 完成不删除新状态；保留旧控制操作与新 resume 的顺序。

相关回归：`tests/control-client.spec.ts`、`tests/lifecycle-bridge.spec.ts`、`tests/archive-observer.spec.ts`、`tests/loader-composition.spec.ts`。真实硬件控制效果需另行验证。

## 操作范围与验证边界

只在本地开发仓修改、构建、测试和打包；本次未 SSH 到 node153、未修改容器或服务器。测试外部模型使用 localhost fixture，凭据是明确的虚拟测试值。没有真实模型性能测量，没有把 HTTP 2xx 当作引擎 KV 成功。

完整浏览器安装后人工交互、非 Messages 适配器支持、153 上的这一新版本功能验证：本次未执行。可安装包和官方服务集成测试证明的范围分别记录，不能替代这些未执行项目。
