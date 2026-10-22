# 迁移与安装

从「单包 DSH 插件」迁移到「Core SDK + DSH 适配层」。

---

## 1. 对使用者：无变化

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| 包名 | `@sasimoreyang-ai/dsh-llm-agent-hint` | 不变 |
| provider | `deepseek-agent-hint` | 不变 |
| 配置 | 插件条目留空（零配置） | 不变 |
| `cordis.patch.yml` | 只插条目、不带配置 | 不变 |
| 公共导出 | `LifecycleBridge`、`ControlBarrierError`、`SessionControlClient` 等 | 全部保留，签名不变 |
| 错误类型 | `LlmError` + `CONTROL_BARRIER` | 不变（Core 内部用自有错误，适配层映射） |

**已安装的用户升级时不需要改任何配置。**

---

## 2. 对包结构：新增一个 workspace 包

```text
dsh-agenthint/
  package.json                 # 仍是 DSH 插件；新增 bundleDependencies
  src/                         # DSH 适配层
    index.ts                   # wiring Core 与宿主服务
    lifecycle-bridge.ts        # DSH 事件 → Core 意图；scope 内前台跟踪
    control-client.ts          # 包装 Core HTTP；注入 attribution headers
    agent-hint.ts              # purpose → requestClass
    types.ts                   # 重导出 Core 类型 + 模块增强
    chat-adapter.ts            # 保留在 DSH
    adapter.ts / extension.ts  # 保留在 DSH
    config.ts / inherited-connection.ts
    archive-observer.ts / composing-service.ts / client/
  packages/
    agenthint-core/            # 零依赖 SDK
  docs/
    sdk.md                     # SDK 参考
    adapter-contract.md        # 适配层能力合同
    integration-baseline.md    # Platform 调查（GAP）
    migration.md               # 本文
```

根 `package.json` 的关键字段：

```json
{
  "dependencies": { "@deepseek-ai/schemastery": "~3.18.4" },
  "devDependencies": { "@sasimoreyang-ai/agenthint-core": "0.6.0-rc.1" }
}
```

- Core 是**构建期依赖**，产物在构建时内嵌进 `lib/vendor/agenthint-core`
- 运行时**没有任何 Core 包引用**，所有 import 在构建时改写为相对路径
- 交付包内不含 `workspace:*`，也不含开发机绝对路径

> 曾经试过两种写法，都不成立：
> 1. Core 写进 `dependencies`（精确版本）→ Git 安装 404，registry 无此版本
> 2. Core 只写进 `bundleDependencies` → `bundleDependencies` 只在 `node_modules`
>    已有该包时才复制；干净克隆没有 `node_modules`，Core 静默消失，
>    pnpm 从 Git 安装后 `MODULE_NOT_FOUND`
>
> 内嵌是唯一对 npm、pnpm、DSH CLI 都成立的方案。

---

## 3. 安装方式（实测结果）

按**包管理器 × 制品来源**分开列，不合并成一句「全部通过」。

| 包管理器 | 来源 | 结果 | 证据 |
|---|---|---|---|
| npm 11 | 单 tarball | ✅ | 35 包，`import` 成功 |
| npm 11 | 配对 tarball | ✅ | 36 包，两者均为 `0.6.0-rc.1` |
| npm 11 | 本地仓库 | ✅ | `import` 成功，内嵌 Core 就位 |
| pnpm 11.7.0 | 本地仓库 | ✅ | 内嵌 Core 14 项就位，主入口 import 成功 |
| pnpm 11.7.0 | `git+file://…` 固定提交 | ✅ | 35 包，主入口 import 成功，`SessionControlClient` 可构造 |
| DSH CLI（pnpm） | tarball | ✅ | 903 ms，真机冒烟通过 |
| 干净克隆（无 `node_modules`） | `npm pack` | ✅ | 66 文件，内嵌 Core 15 项含 LICENSE |

**上一轮报告里「五种安装方式全部通过」的说法不成立**：当时只测了 npm 路径，
把 `git+file://` 的结果当成了 `github:` 的结论，而 DSH 实际用 pnpm。
内嵌改造后重测，pnpm 路径才真正通过。

### 3.1 为什么内嵌是必需的

| 写法 | tarball | npm Git | pnpm Git |
|---|---|---|---|
| Core 在 `dependencies` | ✅ | ❌ 404 | ❌ 404 |
| Core 只在 `bundleDependencies` | ✅ | ✅（靠 workspace 链接） | ❌ `MODULE_NOT_FOUND` |
| **构建期内嵌到 `lib/vendor`** | ✅ | ✅ | ✅ |

`bundleDependencies` 的陷阱：它只在打包时从 `node_modules` 复制。
工作区里因为有链接所以能复制，干净克隆没有链接，复制出来就是空的——
而 `npm pack` 不会报错，只有运行时才 `MODULE_NOT_FOUND`。

### 3.2 安装命令

```bash
# 单包（推荐，Core 已内嵌）
npm install ./sasimoreyang-ai-dsh-llm-agent-hint-0.6.0-rc.1.tgz

# DSH CLI
dsh plugin --profile <profile> add <tarball>

# Git（npm 与 pnpm 均可）
npm  install github:sasimoreyang-ai/dsh-agenthint#<branch-or-tag>
pnpm add     git+https://github.com/sasimoreyang-ai/dsh-agenthint.git#<sha>
```

**不要宣称公网可安装**——Core 尚未单独发布到 registry。但插件本身不再需要它，
外部项目若想直接依赖 Core 包，才需要先发布。

### 3.3 离线安装的边界

内嵌解决的是 Core 的解析问题。插件的 `peerDependencies` 是全部 `@deepseek-ai/*` 包，
`dependencies` 还有 `@deepseek-ai/schemastery`。

- 在 DSH profile 内安装时，peer 已由宿主提供，只需解析 `schemastery`
- **完整断网安装需要预置 Node 依赖闭包**，本轮未提供，属 P4 范围

**Git 安装的阻塞是发布授权问题，不是代码缺陷。** 解除方式：先把 Core 精确版本发布到 registry，再发布插件。

在此之前，内部交付使用**配对制品**：

```bash
# 方式一：单包（Core 已 bundled，推荐）
npm install ./sasimoreyang-ai-dsh-llm-agent-hint-0.6.0-rc.1.tgz

# 方式二：配对（需要独立升级 Core 时）
npm install ./sasimoreyang-ai-agenthint-core-0.6.0-rc.1.tgz \
            ./sasimoreyang-ai-dsh-llm-agent-hint-0.6.0-rc.1.tgz
```

**不要宣称公网可安装。** 当前只有内部制品。

### 3.1 离线安装的边界

单 tarball 安装只解决 Core 的解析问题。插件的 `peerDependencies` 是全部 `@deepseek-ai/*` 包，
`dependencies` 还有 `@deepseek-ai/schemastery`。

- 在 DSH profile 内安装时，peer 已由宿主提供，只需解析 `schemastery`
- **完整断网安装需要预置 Node 依赖闭包**，本轮未提供，属 P4 范围

---

## 4. 历史背景：一个曾经的真实缺陷

> **这一节是背景说明，不是本轮成果。** 该缺陷在基线 `35e1b00` 中已经修好，
> 本轮 `src/index.ts` 与 `src/chat-adapter.ts` 相对基线没有改动。

早期实现用辅助注册函数注入 `prepareExtensions`，但发布版构建里那个函数把
`prepareExtensions` **写死**，不读传入值：

```js
const adapter = new DeepSeekAdapter({
  ...dependencies,                       // ← prepareExtensions 从这里进来
  // ...
  prepareExtensions: (request) =>        // ← 写死，不读传入值
    ctx.get('deepseekLlmApiExtensions')?.prepare(request) ?? /* 空 */
})
```

类型签名允许传，所以：

| 检查 | 结果 |
|---|---|
| 类型检查 | 通过 |
| 单元测试 | 通过 |
| 运行时 | 不报错 |
| **实际效果** | **字段从未注入** |

后来改为直接使用公开的 `registerAdapter` + 自有 `prepareExtensions`。

**教训（对应能力矩阵第 3 项）：只有 hooks 不算数据面接入。**

---

## 5. 行为保持的证据

| 证据 | 结果 |
|---|---|
| 迁移前测试 | 152 项 |
| 迁移后测试 | **183 项**（原 152 项一行未改，全部通过；新增 31 项 Core 测试） |
| 类型检查 | `tsc -b --force` 退出 0 |
| 包完整性检查 | `npm run check` 通过（66 文件，含内嵌 Core 15 项） |
| 会话 ID 编码 | 未改 |
| provider 与配置键 | 未改 |
| 传输协议 | 未改（默认 `/v1/chat/completions`） |

Core 测试从 23 项增至 31 项，新增的 8 项对应审查发现的缺陷（并发首次请求、
异常后 lease 泄漏、迟到 acceptance、未知请求类别、非 JSON cache policy、
transport 抛错结果）。

迁移过程中发现并修正的两处行为差异：

| 现象 | 原因 |
|---|---|
| 7 项 pause 测试失败 | 适配层把新会话的模型名传给了被暂停的旧会话 |
| 2 项凭据超时测试失败 | 在 `Promise.resolve` 内提前 `await`，绕过了超时竞速 |

---

## 6. 回滚

| 场景 | 做法 |
|---|---|
| 插件升级失败 | 装回上一版本 tarball；Core 随包回退，无独立残留 |
| 只用配对制品时 | 同时装回旧版 Core 与旧版插件 |
| 已发布的场景 | 装回上一精确版本即可，不需要卸载平台或重启其他服务 |

回滚**只切回目标组件版本**，不触碰用户会话与工作区。

---

## 7. 已知限制

| # | 限制 |
|---|---|
| 1 | Core 尚未发布到 registry。当前靠 `bundleDependencies` 自足，因此五种安装方式都可用；若要让外部项目**直接依赖** Core 包，仍需先发布 |
| 2 | 完整断网安装的 Node 依赖闭包未提供（P4 范围） |
| 3 | 未知 mutation 隔离在内存中，重启不能证明旧动作已停止；当前约束为单写者部署 |
| 4 | 跨租户的后端 KV 分区需要后端与适配层对同一映射达成一致，SDK 内部分区不等于后端分区 |
| 5 | Platform 集成未接通（见 `docs/integration-baseline.md`） |
