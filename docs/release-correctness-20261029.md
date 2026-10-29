# 0.6.0-rc.5：main 正确性与交付检查修复

日期：2026-10-29。基线：main `eb0e23da6d26160a5af7f945adeb109937b8780b`。
修复分支：`fix/main-release-correctness-20261029`；目标宿主：DSH `0.2.0-rc.2`。

## 改动

1. 更新依赖锁文件到 package.json 声明的 DSH rc.2，将插件候选版本升到 rc.5；打包检查增加根 dependency/peer/dev/engine 声明一致性校验。
2. Chat usage 只有输入、输出两项完整有效时才输出 TokenUsage。空对象、缺项或 null 不再补零，也不覆盖此前完整样本；显式零值保留。无效整数、缓存超过输入、reasoning 超过输出、total 与输入加输出矛盾时抛 MALFORMED_RESPONSE。
3. 浏览器从比较 trimmed 长度改为比较本地完整草稿，首次观察到非空变化时通知。已有草稿的继续编辑、同长度替换可以恢复；持续编辑静默，清空后重新允许通知。只上传 sessionId，不上传文本。
4. 保持 rc.4 的“挂载/切页本身不触发恢复”。公开状态不能区分切页同帧/挂载前粘贴与草稿恢复，所以首次值只作基线。无后续编辑时由普通请求前 resume 兜底；有后续编辑则无需清空就能通知。此边界由组件与 LifecycleBridge 组合测试覆盖，不声称所有立即粘贴都有预取提前量。
5. 更新中英文当前文档、安装引用与可靠性合同；旧 rc.2 的 activated 文档明确属于历史。重新生成 lib，提交产物与构建一致。

## 验证口径

仓库标准入口为 `npm ci`、`npm run check`、`npm pack`，并在重新构建后检查 lib 没有差异。测试覆盖真实 DSH Loader/AgentLoop/Tools/TokenMeter/BasicCompaction 等宿主组件，模型响应使用本地 fixture。

使用 `scripts/check-install.mjs --profile-dir <绝对路径>` 检查安装后的 tarball：核对 profile bundle、真实 server entry 导入、浏览器 bundle 和 route patch。它是安装结构与导入检查，不能替代真实浏览器或服务器 KV 验收。

执行结果与当前候选的范围记录在 [STANDARDIZATION.md](../STANDARDIZATION.md)。

## 使用与回退

安装本分支后选择 DeepSeek (agent-hint)，已有兼容 llm-deepseek 路由时复用配置。安装不自动切换已有会话的 provider。

rc.5 的目标宿主为 rc.2；不承诺在 rc.1 上兼容。回退时安装已保留的原版本 tarball/固定提交并重启对应 DSH 实例；涉及共享服务时先核查归属、影响与当次授权。后端未知控制状态不能靠重启推断已完成，仍按[可靠性合同](reliability.md)处理。

没有修改引擎，也未证明 KV 加载完成、实际消费或 TTFT/E2E 收益。新的计量校验可能暴露兼容后端返回的矛盾 usage，应修复后端或采用另行说明的计量合同，不能将未知值写成零。
