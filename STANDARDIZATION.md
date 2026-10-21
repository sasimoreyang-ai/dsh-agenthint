# 实现与验证记录

## v0.2.0：默认复用现有模型（2026-10-21）

默认安装改为 `mode: inherit`：通过官方扩展注册表给现有 DeepSeek Messages 请求添加 Hint，无需重新配置模型、地址、凭据或默认模型。完整独立控制保留在显式 `standalone` 模式。实现边界和设置机制调查见 [zero-config.md](docs/zero-config.md)。

本次在 Windows 本地执行：

- `npm run check`：类型检查及构建成功，11 个测试文件、71 项测试通过。
- 使用实际 rc.1 Loader、API-key adapter、扩展注册表和 Session，捕获 localhost HTTP：原模型/凭据复用、动态更新、历史与 fork、失败重试、禁用和卸载均通过。
- 独立模式回归：控制 URL/key 快照、每会话串行控制、归档/取消归档并发、旧 stop 完成后保留重开会话状态。
- 浏览器构建 factory 测试：控制 Remote 不存在时不挂载草稿观察器；存在时保留仅 session ID 的通知。
- `npm pack --json`：成功，包含新增 inherit 编译产物、默认 bundle 和设计文档。
- 隔离 `DSH_HOME=.artifacts/v020-install`，通过真实 `dsh plugin --profile web add <tgz>` 安装成功。
- 同一隔离 profile 的 `dsh web --dump-config` 成功：插件只有 `mode: inherit`，原 `agent-default-model` 仍为 `deepseek-official / deepseek-flash`。

安装时 pnpm 报告缺少由宿主提供的 peer 包；`pnpm peers check` 在仅包含插件的 profile 目录中返回非零。本记录不把它写成“零警告安装”。宿主的包映射由 `dsh-app-boot` 的安装范围依赖收集/模块映射负责；profile 配置组合和上述真实服务集成已通过，但本次未进行完整浏览器启动交互验证。

本次没有连接 node153，没有执行真实推理后端或性能实验；不以本地 fixture 结果证明远端 KV 生效。其他协议的 pi-ai 适配器未覆盖，默认模式不包含独立控制请求。

## v0.1.0 历史记录：独立协调器模式

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
