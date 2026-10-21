# DSH AgentHint

面向 **DSH 0.2.0-rc.1** 的独立 AgentHint 插件，将会话身份和生命周期提示传给 MindIE-Motor。在**不修改 DSH 核心、不替换官方包文件**的情况下补齐草稿 `resume` 与归档 `stop`。

包名：`@sasimoreyang-ai/dsh-llm-agent-hint`。这是基于公开 DSH AgentHint 实现维护的社区插件，保留 MIT 许可。[English](README.en.md)

## 安装

需要 Node.js `^22.19.0 || >=24`、pnpm，以及已安装的 DSH **0.2.0-rc.1**。Git 中包含编译后的 Host/浏览器产物，安装时无需编译 DSH，无需核心补丁。

```sh
dsh plugin --profile web add 'github:sasimoreyang-ai/dsh-agenthint#v0.1.0'
```

也可在本仓运行 `npm ci && npm pack`，再通过 `dsh plugin --profile web add /绝对路径/插件包.tgz` 安装。本包尚未发布到 npm registry，不能使用裸包名安装。

安装会自动将插件 bundle 加入 profile。把 [examples/web.patch.yml](examples/web.patch.yml) 中的地址和模型 ID 改成自己的配置，并运行：

```sh
dsh web --patch /绝对路径/web.patch.yml
```

`baseURL` 必须支持 **`/v1/messages`**；控制面使用 **`/v1/chat/completions`**。只有 OpenAI 接口的推理服务需要另行提供 Messages 转换能力。

在 UI 选择 `deepseek-agent-hint` provider 与目标模型，并**新建会话**。既有会话可能保持旧路由。不要同时加载本插件和原版插件并占用同一 provider。

## 配置

```yaml
- id: llm-agent-hint
  name: '@sasimoreyang-ai/dsh-llm-agent-hint'
  config:
    provider: deepseek-agent-hint
    baseURL: http://127.0.0.1:1025
    # apiKeyEnv: MOTOR_API_KEY  # 可选；不配置则不发 Authorization
    models:
      - id: YOUR_SERVED_MODEL
        name: YOUR_SERVED_MODEL
    agentHint:
      enabled: true
      sessionControl:
        enabled: true
        pluginTriggers: true
        # endpoint: http://127.0.0.1:1025/v1/chat/completions
        pendingOpAwaitMs: 2000
        controlTimeoutMs: 5000
        retries: 1
```

上面为条目内容；`--patch` 文件的完整格式见示例。地址和模型为示例；共享服务器使用前核对目标和权限。凭据放在 credential provider 或启动环境中，不写入仓库。

`agentHint.enabled: false` 关闭 Hint；`sessionControl.enabled: false` 只关闭控制面。`pluginTriggers: false` 关闭本项目新增的 Remote 与归档观察器，保留原生监听和请求前恢复兜底。基础连接、输出、图像和 Files 参数沿用 rc.1 的公开 Messages Adapter。

## 生命周期

| 提示 | 触发与去重 |
| --- | --- |
| start | 新会话第一条普通请求携带，HTTP 2xx 后记账，后续不重复 |
| pause | 另一会话请求被接受，前一会话到达 idle 时发送 |
| resume | 草稿从空白变为非空时通知宿主；已暂停且属于本路由的会话发送一次；无浏览器时在下一普通请求前兜底 |
| compact | 本路由已使用会话的 compaction/end 成功，无 error |
| stop | 公共 archiveSession 成功且归档状态新增后发送；销毁也触发；同一次归档和随后销毁去重 |

浏览器只发送 session ID，**不上传草稿正文**。挂载已有草稿、纯空格、继续输入和切到已有草稿，不冒充一次新的输入跃迁。清空后再次输入是新的客户端通知，宿主仍按生命周期去重。

归档失败不发 stop；重复归档不重复发送；取消归档后允许新的周期。不对未使用本 provider 的其他会话发控制。历史会话若尚未知模型/路由，在普通请求前兜底，不对所有恢复会话批量预取。

控制为 advisory：失败不阻塞打字，不导致业务请求失败；业务请求的控制等待有上限。默认 retries=1 表示失败时最多两次 HTTP 尝试，不代表 exactly-once。HTTP 2xx 只代表接口接受；物理 KV 完成、实际命中和性能收益须用引擎证据验证。

## 纯插件实现

1. 直接使用公开 DeepSeekAdapter 与 llm.registerAdapter，在本 provider 注入 Hint。rc.1 的 registerDeepSeekProvider helper 会覆盖外部传入的 prepareExtensions，不能直接用该 helper 保留本回调。
2. 插件注册 AgentHintSignals Service，由官方 Gateway 动态发现，经现有认证 Connection 接收 composing。
3. 通过 conversation.input.overlay 和 useInput 读取公开草稿状态，不读取 DOM 私有节点，不改输入组件。
4. 对公共归档/取消归档方法安装可恢复观察器，保持 receiver、返回值与异常；卸载时不覆盖之后安装的其他包装。

缺少 Gateway/UI 时相应能力降级，普通请求、start/pause/compact、请求前恢复和销毁 stop 仍可用。详见 [路径 B 证据](docs/path-b.md)。[核心补丁](core-patch/CORE-PATCH.md) 仅保留为历史提案，当前安装不需要执行。

## 开发验证

```sh
npm ci
npx tsc -b --force
npm test
npm pack
```

Host 与 Client 分别编译，npm test 先构建安装产物。测试使用官方 rc.1 Loader、Gateway、Session 和 WorkspaceRegistry，捕获真实 localhost HTTP 请求；仅外部模型响应与持久化介质使用测试替身。还覆盖草稿跃迁、失败归档、去重与卸载恢复。执行记录见 [STANDARDIZATION.md](STANDARDIZATION.md)。

lib 随 Git 提交，支持 GitHub 直接安装；源码变更后运行 npm run build 并提交产物。CI 检查编译、测试、打包和产物一致性。本地备份、node_modules、实验文件不进入 Git/npm 包。

## 模型与 KV 影响

不新增模型可见提示词，Hint 位于模型内容之外。独立控制请求仍有服务端处理成本。暂停、预取、驱逐、TTL 与共享前缀由协调器/引擎负责；本插件不部署推理服务，不选择 Mooncake/memcache，不承诺加速比例。

## 兼容范围与限制

支持并测试 DSH 0.2.0-rc.1，rc.2 及以后需重新验证。归档观察器属于公共服务对象的运行时包装；宿主若冻结方法，观察器降级，销毁 stop 保留。退出过快可能来不及送达 stop。状态未知的超时不代表引擎操作已取消。

## 许可

[MIT](LICENSE)。上游与改动归属见 [NOTICE](NOTICE)。
