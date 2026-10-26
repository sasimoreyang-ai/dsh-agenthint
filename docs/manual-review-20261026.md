# 2026-10-26：手动实验缺陷复核与修复

本次是基于 feat/agenthint-core-sdk（f12b661）的 0.6.0-core.2 修复候选，保留 core SDK 拆分、vendoring、指纹检查和安装矩阵。与未拆分版本0.6.0-rc.2使用不同插件版本，避免安装缓存混淆。Core SDK仍为0.6.0-rc.1，状态机/HTTP传输未修改。本说明区分源码修复、本地验证、团队提供的实机数据和仍未验证的性能结论。没有重新部署或重启 node153。

## 客户端恢复触发

此前 observer 只观察同一会话的草稿空→非空。切换与粘贴同批提交，或 observer 挂载前已经有草稿时，确实可能漏掉该跃迁。

现在公共 `conversation.input.overlay` 组件挂载/切换 sessionId 时发送 `agentHintSignals/activated`，不读或上传草稿内容。服务端只复用现有会话恢复判定，未知/归档/新空会话不发控制；activation、composing 和请求前恢复共用既有幂等、队列和屏障。连续编辑、清空重贴仍保留 composing 行为；恢复持久化草稿不冒充用户输入，但组件激活本身可以请求恢复。React 重挂载可能重复发通知，去重在服务端完成，不声称客户端 RPC 恰好一次。

测试覆盖同批切换+粘贴、粘贴后挂载、已有草稿、空白字符、连续编辑/清空重贴、打包后的浏览器 factory、Gateway 两种 Remote 合并为一次 resume，以及卸载后不再发通知。本地替身模型与 HTTP 测试不证明真实 KV 加载或性能收益。

## 启动警告与安装检查

本轮手动实验首次启动因新 profile 仅链接了插件目录而缺失 `@deepseek-ai/dsh-llm`，server entry 导入失败；补齐私有依赖路径并重启本次 DSH 后正常。原日志采用追加模式，旧警告仍留在文件前部。不能据此推出 client bundle 未加载，也不能把旧日志作为修复后仍失败的证据。

在已有指纹/依赖/bundle检查上新增实际导入检查，实际在新 Node 子进程中导入安装路径的 server entry，检查 profile bundle、浏览器 bundle 文件和路由 patch。缺失 peer 时以失败退出并显示具体模块。它不会启动 DSH、不发送模型请求；bundle 存在不等于浏览器已经激活。

```sh
node /path/to/plugin/scripts/check-install.mjs --profile-dir /path/to/DSH_HOME/profiles/verify
```

检查脚本随 tarball 发货。安装时必须使用不同版本/固定 commit，避免同名同版本旧缓存混淆；不要手工删除共享 node_modules。保留 `--profile <name> --expect-digest <hex16>` 用法并兼容 `--profile-dir`。独立 profile 的启动验收应读取该次启动的新日志，不混用累计日志。

原有 core 导入扫描也已修正：忽略文档注释，实际扫描 core 根入口与子路径导入；不会再把 JSDoc 中的包名误判成残留运行时依赖。实际安装检查保留内容指纹，错误指纹仍失败。两条线的版本/分支分别为未拆分 `0.6.0-rc.2` / `fix/session-activation-20261026`，拆分 `0.6.0-core.2` / `fix/core-session-activation-20261026`。

## 性能和引擎侧结论

| 报告项目 | 本次处理与边界 |
| --- | --- |
| P0-1 恢复漏触发 | 源码修复，新增 activation；以客户端 factory、Gateway 和既有桥接器验证，不等待用户再输入才有恢复机会。 |
| P0-2 import warning | 已有会话证据说明是早期 server peer 缺失；新增实际导入检查，防止文件/版本存在却无法加载。 |
| P1-1 提前量不足 | 从会话输入组件激活时提前触发；保留现有屏障和失败策略。没有新增等待 KV-ready 的阻塞，也未声称消除所有控制等待。 |
| P1-2 TTL/hash 过量 | 引擎单位、压缩 KV、滑窗、外部注册 hash 与物理块不是同一口径，不能用计数比值直接证明 HBM 全钉住。不在插件伪造 HBM 配额或擅发 stop 驱逐会话；需要引擎合同与观测。 |
| P2-1 逐请求命中 | 后端未返回的字段仍未知。插件无法从聚合命中率、TTFT 或 prompt_tokens 推算 external/local token 数；观察方应记 `null`，reason=`backend_did_not_report_per_request_cache_tokens`。本次未伪造这些字段，也未把已有代理改成引擎遥测接口。 |

报告中的 ON=2759.0ms、OFF=2213.1ms 是团队提供的单 pair 点估计，不能推断一般退化，更不能仅凭“比冷启动快”证明 OFF 从外部恢复了某个 token 数。CPU/NPU重算、HBM命中、外部加载、调度和背景流量均可能影响时延。resume HTTP 返回不等于 prefetch-ready；8.7ms 提前量和多出的546ms不能单独证明发生带宽争抢。

正式反序 ON/OFF 复测尚未执行，性能非劣和收益均未验收。必须分别保留目标失效、外部候选、加载完成/消费、实际提前量、OFF 基线路径、输出完整性、失败分母和重复样本，缺少的观测记 unknown。不能把功能修复写成“已获得收益”。

原有 Hint 注入、accept 记账、pause/compact/stop 逻辑、普通请求屏障、OFF 隔离、cache policy 均保留。
