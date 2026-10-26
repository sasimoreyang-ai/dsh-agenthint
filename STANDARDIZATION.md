# 实现与验证记录

## 0.6.0-rc.2：浏览器恢复触发修复（2026-10-26）

基于未拆分 main（35e1b00），增加输入组件挂载/切换会话的 `activated` Remote，保留 composing 和请求前恢复。只传 sessionId，共用既有恢复幂等与屏障。未修改 Hint 注入、accept 记账、OFF 开关或引擎 TTL 策略。

本地执行 `npm run check`：17 个测试文件、157 个测试通过；类型、构建和 npm 打包内容检查通过。测试包括浏览器 factory 的切换通知、Gateway 两种信号产生一次 resume、持久化草稿/空白编辑、卸载后停止通知与实际安装导入失败检测。

实际 `npm pack` 的 0.6.0-rc.2 tarball 已解包到新私有 profile，在本地 stock DSH 0.2.0-rc.1 CLI 启动。该次新日志仅输出下行，没有 `did not activate` 或 `failed to import`；认证 token 已脱敏：

```text
dsh web: http://127.0.0.1:50134/?token=REDACTED
```

profile 不提供 agenthint-core，复用同版本 DSH peers；目标模型端点设为 `127.0.0.1:1`，未发送模型推理。验收后仅停止该次本地子进程。这里证明打包产物的本地加载，不代表全新机器的所有安装器都通过，也不代表 node153 实机、KV/prefetch-ready 或性能非劣验收。

新增随包安装检查：`node scripts/check-install.mjs --profile-dir <profile绝对路径>`。逐项处置、原报告推断的边界见[手动实验修复复核](docs/manual-review-20261026.md)。本候选未发布 npm 或 tag，未部署服务器。

## 0.6.0-rc.1：v0.5.5审查修复候选（2026-10-22）

从43bac64创建`codex/agenthint-v055-hardening`。本候选尚未发布tag/npm，未在node153部署、执行真实模型/KV或性能实验。以下v0.5.x的153结果是历史记录，不能替代本候选验收。

修复消息角色/工具结果、模型context与输出上限、思考默认值、流内错误/异常EOF/CRLF/DONE、工具分片、错误分类、取消和空闲超时；完整流lease覆盖direct与prepared入口。控制请求不盲目重试mutation，未知结果隔离，卸载取消，resume明确失败可恢复。配置按活动来源实际值逐次解析并热更新，端点/凭据引用固定同代，规范化/v1与实际model。

新增真实官方AgentLoop、Tools、TokenMeter、BasicCompaction与Loader集成：工具两步闭环、自动压力压缩提交后compact、后台标题不记账、配置热更新。模型HTTP和凭据服务使用本地fixture。包/锁版本对齐，移除旧inherit产物，包内文档和当前链接自动检查。

本次Windows/Node24.19.0执行：`npm run check`类型检查、构建及16个文件/152项测试通过；包内exports、文档链接与锁版本检查通过。独立DSH_HOME/profile的CLI tarball安装与`web --dump-config`成功；profile安装仍报告由宿主提供的peer依赖告警，不写成零告警。依赖复用本地固定版本，非全新操作系统验收。最终tarball哈希与完整命令日志保存在桌面交付目录。

不以本地fixture声明真实KV或企业环境性能合格。当前合同见[README](README.md)、[传输](docs/transport.md)、[可靠性](docs/reliability.md)与[审查项闭环](docs/review-resolution.md)。

## v0.5.x：新增 chat/completions 传输，原厂引擎可用（2026-10-22）

### 为什么

外部 KV 缓存按会话工作，引擎必须收到 `agent_hint`。原厂镜像的两个入口支持不同：

```
anthropic/protocol.py                agent_hint 出现 0 次   ← 字段被静默丢弃
openai/chat_completion/protocol.py   agent_hint 出现 9 次   ← 字段保留
```

DSH 自带的 DeepSeek 适配器走 Messages，因此在原厂引擎上：

- 请求成功（HTTP 200）
- 但 `register context management … session id None`
- `pause`/`resume` 报 `has 0 hash/block in SAM`，全部 no-op

此前唯一出路是改引擎补两行，但那不可交付（容器重建即失效）。

### 改了什么

新增 `ChatCompletionsAdapter`（`src/chat-adapter.ts`），数据面改走 `/v1/chat/completions`。新增 `transport` 配置，默认 `chat`。

| 版本 | 修复 |
| --- | --- |
| v0.5.0 | 适配器本体、`transport` 配置项 |
| v0.5.1 | chat 端点 URL 少 `/v1` 前缀 |
| v0.5.2 | 协调器用 `delta.reasoning` 而非 `delta.reasoning_content`，只认后者会丢失全部思维链 |

两种传输共用 `buildAgentHint`、`LifecycleBridge` 屏障与 `accept` 记账；控制面本就走 chat/completions，不受影响。

### 本地验证

- `npx tsc -b --force` 退出码 0
- `npx vitest run`：**12 个测试文件、90 项测试通过**
- 新增 `tests/chat-adapter.spec.ts`：分块翻译、`reasoning` 字段名、工具调用、请求体映射、空响应守卫

### 真机验证（node_153，原厂镜像，零补丁）

环境：`messages` 端点补丁 0 处、Motor 近两天 0 个文件被改、后端 memcache、配置哈希 `e79ea964…` 与原始一致。

**抓包证据**（本地日志代理截获插件真实请求体）：

```
路径: /v1/chat/completions
✅ agent_hint: {"session_id": "session-a5928c27-…", "session_control": {"type": "start"}}
工具数: 24   消息数: 3

后台请求（标题生成）:
✅ agent_hint: False      ← 正确排除
```

**引擎侧**：

```
register context management … session id session-a5928c27-…
on_blocks_allocated_for_request, session_id = session-a5928c27-…
```

**四动作**：

| 会话 | 动作 | 结果 |
| --- | --- | --- |
| `a5928c27` | pause → offload | `status=True`，676 块 |
| `a5928c27` | stop → evict | `status=True`，676 块 |
| `c8318872` | pause → offload | `status=True`，678 块 |
| `c8318872` | resume → prefetch | `status=True`，678 块 |
| `c8318872` | stop → evict | `status=True`，678 块 |

零失败、零 no-op。

**收益**（100K 长前缀 + 6 会话 600K 工作集 > HBM 470K）：

| 场景 | TTFT |
| --- | --- |
| 冷态 | 25.74 s |
| 连接器被动载入 | 2.35 s |
| Hint 主动预取 | 2.10 s |

Hint 增量 **10.7%**，端到端 **91.9%**。预取耗时 1.03 s。

### 边界

- 收益需要长前缀与 HBM 压力；26K 短会话下增量接近 0
- 收益需要提前量；预取约 1.03 s
- 图片/文件/工具声明类内容块在 chat 传输下被丢弃，不报错
- 每场景 n=4，方向一致但不足以给严格置信区间
- 未测并发争抢、真实 DSH 工具任务、界面内计时

设计说明见 [docs/transport.md](docs/transport.md)。

---

## v0.4.0：移除 inherit 模式，端点改为继承（2026-10-21）

**移除 `mode: inherit`。** 该模式不发送独立控制请求，因而无法触发卸载与预取；而 v0.3.0 的端点继承已经让 standalone 模式同样不需要手写地址与模型，inherit 的主要理由消失。保留它会让用户以为「装了就有加速」。

**新增端点与模型目录继承。** 插件条目不再包含 `baseURL` 与 `models`，二者从 `llm-deepseek` 路由读取，优先级为：显式配置 > 继承 > `DSH_AGENT_HINT_BASE_URL` > 内置默认。实现见 `src/inherited-connection.ts` 与 [docs/endpoint-inheritance.md](docs/endpoint-inheritance.md)。

**修复客户端启动故障。** v0.2.0 把 `remote.agentHintSignals` 放进 `inject` 硬依赖，inherit 模式下该服务不存在，浏览器启动报 `1 entry did not activate`。改为 `ctx.inject` 运行时等待：条目立即激活，控制服务出现后才贡献插槽。

本地验证（Windows）：

- `npx tsc -b --force` 退出码 0
- `npx vitest run`：11 个测试文件、85 项测试通过
- `npm pack`：0.4.0 构建产物完整

真机验证（node_153，Ascend 910B3 × 8 + MindIE-Motor）：

- 插件条目零配置（只有 `agent_hint` 相关缺省），请求成功，证明继承生效
- 五动词全部触发：`start` 22、`pause` 18、`resume` 11、`stop` 11、`compact` 1
- 引擎四动作成功执行，每次 4,917 块

**发现的引擎侧限制（未修复，属协调器）**：`/v1/messages` 路径不向 session-aware 管理器登记块记录，`/v1/chat/completions` 会。DSH 的 DeepSeek 适配器使用 Messages 协议，因此经 DSH 发出的请求拿不到可卸载的块。同一会话改用 `/v1/chat/completions` 播种后四动作立即成功：

```
offload  status=True  actual_op_block_num 4917
prefetch status=True  actual_op_block_num 4917
evict    status=True  actual_op_block_num 4917
```

该结论由同一容器、同一引擎补丁下的对照实验得出，唯一变量是请求端点。

---

## v0.2.0：默认复用现有模型（2026-10-21，已在 v0.4.0 移除）

以下内容为历史记录。`mode: inherit` 已在 v0.4.0 移除，相关设计文档 `docs/zero-config.md` 一并删除。
默认安装改为 `mode: inherit`：通过官方扩展注册表给现有 DeepSeek Messages 请求添加 Hint，无需重新配置模型、地址、凭据或默认模型。完整独立控制保留在显式 `standalone` 模式。实现边界和设置机制调查见当时的设计文档（已随该模式一并删除）。

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
