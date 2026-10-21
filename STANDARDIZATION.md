# 路径 B 实现与验证记录

日期：2026-10-21。交付包：@sasimoreyang-ai/dsh-llm-agent-hint 0.1.0。目标宿主：官方 npm DSH 0.2.0-rc.1。

## 已实现

- 无核心文件补丁的 composer Remote、公共 Slot 草稿观察、成功归档/取消归档观察。
- 原生与插件触发源去重，只对本 provider 已使用的会话发控制；保留销毁与请求前恢复。
- 修复 rc.1 注册 helper 覆盖 prepareExtensions，改用公开 Adapter 注册。
- Host/Client 编译面、可安装产物、profile bundle、中文/英文文档、配置示例和 CI。

## 已执行的检查

| 检查 | 结果 |
| --- | --- |
| npx tsc -b --force | exit 0 |
| npm run check | exit 0；10 个文件、65 项测试通过 |
| 官方 Gateway 调用插件 Remote | 通过；卸载后不可调用 |
| 官方 Loader 加载编译产物并进行 localhost HTTP 请求 | 通过；start、pause、resume、compact、stop；后台请求无 Hint |
| 官方 Registry 经 Cordis Service 视图归档和恢复 | 通过；归档后 stop、卸载还原公开方法 |
| 浏览器编译 factory + 官方 SlotRegistry | 通过；仅上传 session ID、输入跃迁去重、卸载撤回 |
| npm pack | exit 0，包含 Host、Client、bundle patch 和许可 |
| 独立 DSH_HOME 中 dsh plugin add 本地 tgz | exit 0；自动加入 profile bundles |
| dsh web --patch examples/web.patch.yml --dump-config | exit 0；模型/插件配置正确组合 |
| npm audit --omit=dev | 未报告运行时依赖漏洞（本次查询） |

另外已在 workspace 之外新建独立消费者目录，通过 npm install --omit=dev --ignore-scripts 安装 tgz；安装了 35 个包，主入口与 buildAgentHint 导入成功，审计未报告漏洞。GitHub tag 安装在推送后单独验证；源码目录加载不冒充独立安装。

## 未通过或未执行的范围

完整 web profile 的 --dump-config-schema 返回非零：官方预置树的 /179 至 /182 有四项 unrecognized Loader tree carrier。未加载本插件的基线也出现相同四项，属于该发布宿主的既有检查问题。本插件条目及 pluginTriggers schema 已被识别。没有绕过该检查，也未修改官方源码修复。

测试中模型响应与持久化介质可控替代，不代表真实模型/NPU/KV 集成或性能。未连接 node153，未切 memcache/Mooncake，未宣称加速效果。完整浏览器应用交互尚未做人工实机验收；已验证实际浏览器产物、公开 Slot、RPC 与宿主数据/控制 HTTP 链路。

开发测试安装了固定的官方 DSH CLI；其开发依赖树另有上游审计告警，不通过升级宿主或强制覆盖依赖来掩盖。运行时依赖审计与包含整个开发 CLI 的审计不能混为一谈。

## 可复现

npm ci → npx tsc -b --force → npm test → npm pack。安装参见 README。安装后选择正确 provider/model 并新建会话；不会自动切换已有会话路由。

原目录在修改前已备份到本地忽略路径 .local-backup。官方 checkout 与参考 fork 均未写入。GitHub 推送只包含本插件项目；不包含节点配置、凭据、node_modules、备份和本地实验输出。
