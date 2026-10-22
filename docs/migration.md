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
  "dependencies": { "@sasimoreyang-ai/agenthint-core": "0.6.0-rc.1" },
  "bundleDependencies": ["@sasimoreyang-ai/agenthint-core"]
}
```

- 依赖用**精确版本**，不用 `workspace:*`
- `bundleDependencies` 把构建好的 Core 打进插件 tarball，因此单包安装不查 registry

---

## 3. 安装方式（实测结果）

| 方式 | 结果 | 说明 |
|---|---|---|
| 单 tarball 安装 | ✅ 通过 | 35 个包；Core 从 bundled 副本解析，运行期正常 |
| 配对 tarball 安装 | ✅ 通过 | 36 个包；两者都解析到 `0.6.0-rc.1` |
| 本地仓库安装 | ✅ 通过 | `import` 成功，bundled Core 就位 |
| `github:` Git 安装 | ❌ **阻塞** | `@sasimoreyang-ai/agenthint-core@0.6.0-rc.1` 未发布，registry 返回 404 |

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

## 4. 迁移中修正的一个真实缺陷

拆分时发现：旧实现的辅助注册函数在展开参数后**覆盖了调用方传入的 `prepareExtensions`**。

```js
// 发布版构建里的实际行为
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

拆分后改为直接使用公开的 `registerAdapter` + 自有 `prepareExtensions`，
并补了针对真实 HTTP 请求的抓包断言。

**教训：只有 hooks 不算数据面接入（能力矩阵第 3 项）。**

---

## 5. 行为保持的证据

| 证据 | 结果 |
|---|---|
| 迁移前测试 | 152 项 |
| 迁移后测试 | **175 项**（原 152 项一行未改，全部通过；新增 23 项 Core 测试） |
| 类型检查 | `tsc -b --force` 退出 0 |
| 包完整性检查 | `npm run check` 通过（47 → 63 文件，含 bundled Core） |
| 会话 ID 编码 | 未改 |
| provider 与配置键 | 未改 |
| 传输协议 | 未改（统一 `/v1/chat/completions`） |

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
| 1 | `github:` 安装阻塞于 Core 发布授权 |
| 2 | 完整断网安装的 Node 依赖闭包未提供（P4） |
| 3 | 未知 mutation 隔离在内存中，重启不能证明旧动作已停止；当前约束为单写者部署 |
| 4 | 跨租户的后端 KV 分区需要后端与适配层对同一映射达成一致，SDK 内部分区不等于后端分区 |
| 5 | Platform 集成未接通（见 `docs/integration-baseline.md`） |
