# 0.6.0-rc.6：main 正确性与真实浏览器验收修复

日期：2026-10-29。基线：main `eb0e23da6d26160a5af7f945adeb109937b8780b`。
修复分支：`fix/main-release-correctness-20261029`；目标宿主：DSH `0.2.0-rc.2`。

## 改动

1. 更新依赖锁文件到 package.json 声明的 DSH rc.2，将插件候选版本升到 rc.6；打包检查增加根 dependency/peer/dev/engine 声明一致性校验。
2. Chat usage 只有输入、输出两项完整有效时才输出 TokenUsage。空对象、缺项或 null 不再补零，也不覆盖此前完整样本；显式零值保留。无效整数、缓存超过输入、reasoning 超过输出、total 与输入加输出矛盾时抛 MALFORMED_RESPONSE。
3. 真实浏览器验收发现 rc.5 等待的 `remote.agentHintSignals` 不会由第三方 Host Remote 自动生成，导致观察器不挂载。改依赖 stock `connection`，每个连接世代发一次只读 `available` 探测，成功后挂载；断连/卸载撤销，忽略过期结果。
4. 真实 raw RPC 必须使用 `{args:{request:{sessionId}}}`，无参数能力探测使用 `{args:{}}`。修复缺少 args 封装的问题；新增真实 Gateway carrier/interceptor 回归，避免直接 invoke 绕过封装校验而误通过。
5. rc.5 草稿快照比较会把异步恢复旧草稿误当编辑。改在当前 composer 内监听 beforeinput/paste/input，快照仅在清空后重置通知状态；恢复草稿及导航均静默。已有草稿同长度编辑可以通知，持续编辑去重，只上传 sessionId。依赖 pinned rc.2 的 DOM 标记；缺标记、能力探测失败或监听器挂载前编辑依赖普通请求前恢复，不承诺所有粘贴都有提前量。
6. 更新中英文当前文档、安装引用与可靠性合同；旧 rc.2 的 activated 文档明确属于历史。重新生成 lib，提交产物与构建一致。
7. 安装检查默认使用严格原生 Node 导入；真实 stock CLI profile 可能由 DSH runtime resolver 提供公共 peer，原生导入失败不能单独判定插件无法加载。增加显式 `--dsh-install-anchor <实际运行的DSH/package.json>`，在新进程中安装同一 stock 只读 resolver 后仅导入插件，不启动插件或推理。不会默默借用开发仓依赖；真正缺包仍失败。

## 验证口径

仓库标准入口为 `npm ci`、`npm run check`、`npm pack`，并在重新构建后检查 lib 没有差异。测试覆盖真实 DSH Loader/AgentLoop/Tools/TokenMeter/BasicCompaction 等宿主组件，模型响应使用本地 fixture。

使用 `scripts/check-install.mjs --profile-dir <绝对路径>` 检查安装后的 tarball：核对 profile bundle、真实 server entry 导入、浏览器 bundle 和 route patch。它是安装结构与导入检查，不能替代真实浏览器或服务器 KV 验收。

stock CLI 管理的 profile 应显式加 `--dsh-install-anchor /绝对路径/实际运行的DSH/package.json`，与宿主的依赖解析一致；不加时只检查原生 Node 解析。不得填开发仓路径冒充实际运行的安装。

本轮独立浏览器验收从远端克隆开始，通过真正 `dsh plugin --profile browser add <tarball>` 安装候选包，再启动 stock DSH rc.2 Web 与本机 fixture 模型。Playwright 驱动真实界面验证 start、切换后 pause、输入后发送前 resume、去重、回访静态 ID、草稿恢复静默、同长度编辑及归档 stop；另验收 full OFF。未手工注入不存在的客户端 Remote 服务。

执行结果与当前候选的范围记录在 [STANDARDIZATION.md](../STANDARDIZATION.md)。

## 使用与回退

安装本分支后选择 DeepSeek (agent-hint)，已有兼容 llm-deepseek 路由时复用配置。安装不自动切换已有会话的 provider。

rc.6 的目标宿主为 rc.2；不承诺在 rc.1 上兼容。回退时安装已保留的原版本 tarball/固定提交并重启对应 DSH 实例；涉及共享服务时先核查归属、影响与当次授权。后端未知控制状态不能靠重启推断已完成，仍按[可靠性合同](reliability.md)处理。

没有修改引擎，也未证明 KV 加载完成、实际消费或 TTFT/E2E 收益。新的计量校验可能暴露兼容后端返回的矛盾 usage，应修复后端或采用另行说明的计量合同，不能将未知值写成零。
