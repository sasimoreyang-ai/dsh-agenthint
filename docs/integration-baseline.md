# Platform 集成基线（P0）

调查日期：2026-10-22
结论等级：**P0 = GAP（Platform 侧未接通）**；Core/DSH 拆分不受影响，见 §7。

本文件只记录**已核对到源码或制品证据**的事实。凡是当前源码不能证明的，标 `GAP`，不推测接口、不把 Platform 阶段标成已完成。

---

## 1. 核查对象与固定版本

| 对象 | 版本 / 提交 | 位置 |
|---|---|---|
| MindAgent-Platform | `master` @ `6d2073fcb45718656bf4d1a5c82f9016a5c54cb6` | `C:\Users\koute\Desktop\WorkSpace\MindAgent-Platform-plan-20261022` |
| 插件仓基线 | `codex/agenthint-v055-hardening` @ `35e1b009e66278ac612d2df0c13ae176ffeb05d0`，候选 `0.6.0-rc.1` | `C:\Users\koute\Desktop\WorkSpace\dsh-agenthint-hardening` |
| 本轮工作分支 | `feat/agenthint-core-sdk` | 同上 |
| 插件 DSH peers | `0.2.0-rc.1` | 插件 `package.json` |

Platform 为只读调查副本，未递归初始化子模块。

---

## 2. 六个必答问题

### Q1 — DSH 运行在客户端、每用户服务器实例还是共享服务？由谁安装和启动？

**GAP。**

Platform 主仓当前没有任何 DSH 安装或启动入口。证据：

| 检查 | 结果 |
|---|---|
| 全仓精确搜索 `DeepSeek Harness` / `deepseek-harness` / `@deepseek-ai` / `dsh-llm` / `dsh-web`（排除 `node_modules`、`.git`、`skills/`） | **0 处命中** |
| `DOCS/THIRD-PARTY.md` | 仅标题「# MindAgent第三方适配」，无正文 |
| `DOCS/DEPLOY.md` 组件清单 | moosefs、jiuwenbox、agent-runtime、agent-gateway、jiuwenswarm 五个模块 + etcd，**无 DSH** |
| `scripts/build.sh` 构建目标 | `MindAgent-Gateway`、`MindAgent-Boost` 等，**无 DSH** |

`README.zh.md` 声明支持 DSH 与第三方 Agent，但该声明是文档事实，不是安装链证据。

**未核对**：Client、Manager、未展开的子模块、以及 `scripts/package.sh` 打包的外部 agent-os Server bundle 内部是否另含 DSH 入口。这些不在当前只读副本范围内。

### Q2 — DSH/Node 版本、执行用户、profile、DSH_HOME、运行目录？

**GAP。** 依赖 Q1，运行归属未确认，无法给出。

本轮在 node_153 上验证过的**开发环境**事实（仅供后续对照，不代表 Platform 约定）：

| 项 | 值 |
|---|---|
| DSH | `0.2.0-rc.1` |
| 执行用户 | `root`（开发机） |
| DSH_HOME | `/root/.dsh-agenthint-verify` |
| 运行目录 | `/root/dsh-verify` |
| profile | `verify`（web :3090）、`verify-hl`（headless） |

### Q3 — 默认 provider 与 model 的实际读写入口？

**GAP（Platform 侧）。**

插件侧已知：DSH 通过 `agent-default-model` 插件的 `provider` / `model` 配置决定新会话默认路由，写入口是 profile 的 `cordis.patch.yml`。这是 DSH 的入口，不是 Platform 的供给入口。

Platform 侧未找到对 DSH 默认 provider 的写入实现。

### Q4 — Manager 如何供给模型连接、身份与密钥引用？

**GAP（对 DSH 的供给路径）。**

`DOCS/DEPLOY.md` 记录模型端点「经 Manager/LiteLLM 供给」，用户工作区「带外供给：Manager `create_user`」。这是对 **agent-os 运行时**的供给，没有证据表明它同时覆盖 DSH profile。

插件侧设计已按「管理员配置一次、用户不重复填写」准备：插件从 `llm-deepseek` 路由继承 endpoint 与模型目录（见 `docs/endpoint-inheritance.md`），因此平台只需供给 DSH 的 `llm-deepseek` 连接即可，插件条目保持零配置。**该路径尚未在 Platform 上验证。**

### Q5 — 模型请求经过哪些网关？控制请求如何到达同一缓存域？

**GAP（Platform 路由）。**

`DOCS/DEPLOY.md` 提到 Manager/LiteLLM 与模型网关，但未给出对 DSH 请求的跳数与鉴权规则。

插件侧已知的开发机直连路径（非 Platform 路径）：

```
DSH → coordinator :1025 → 引擎 → KV / memcache
```

控制请求与普通请求走**同一端点** `/v1/chat/completions`，区别只在 body：

- 普通请求：`messages` 有内容 + `agent_hint.session_id`
- 管理请求：`messages` 为空 + `agent_hint.session_control`

同一端点是设计要求：`session_control` 只有在与产生块的请求同域时才有效。**Platform 网关是否允许空 `messages` 的请求、是否会过滤 `agent_hint`，尚未验证。**

### Q6 — 固定版本的部署引擎支持什么组件扩展接口？

**GAP。**

`scripts/mindagent`、`scripts/deploy.sh` 是 agent-os 包装层；`scripts/package.sh` 从外部 Server bundle 原样打包。仓内未见面向第三方 Agent 组件的注册接口。

`AGENTS.md` 要求独立发行组件以 Git submodule 维护并显式固定提交，这给出了**组件仓的组织约定**，但不等于运行时存在组件扩展点。

---

## 3. 已证实 vs 未证实

| 结论 | 证据 | 等级 |
|---|---|---|
| Platform 文档声明支持 DSH 与第三方 Agent | `README.zh.md` | 文档声明 |
| 第三方适配文档无具体接口 | `DOCS/THIRD-PARTY.md` 仅标题 | 源码事实 |
| 部署模块清单不含 DSH | `DOCS/DEPLOY.md` | 源码事实 |
| 主部署 CLI 是 agent-os 包装层 | `scripts/mindagent`、`scripts/deploy.sh` | 源码事实 |
| 部署树从外部 bundle 原样打包 | `scripts/package.sh`、`scripts/build.sh` | 源码事实 |
| 仓内无 DSH 安装实现 | 精确搜索 0 命中 | 源码事实（限当前副本） |
| **Platform 已具备 DSH + 插件一键部署闭环** | —— | **未证实，标 GAP** |

---

## 4. 对交付范围的影响

按任务书 §三：外部资料无法获得时明确 GAP，继续独立的 Core/DSH 拆分，不猜造接口，也不把 Platform 阶段标成已完成。

因此本轮范围收敛为：

| 工作包 | 状态 |
|---|---|
| P1 Core 纯类型提取 | 进行中 |
| P2 协调器与传输拆分 | 进行中 |
| P3 SDK/插件发行闭环 | 进行中 |
| P0 入口与合同核对 | **GAP**（本文件） |
| P4 Platform 构建与打包 | 阻塞于 P0 |
| P5 配置与运行接入 | 阻塞于 P0 |
| P6 正式路由验收 | 阻塞于 P0 |
| P7 真机与交付（Platform 侧） | 阻塞于 P0 |

---

## 5. 解除 GAP 所需的最小信息

按优先级，任一即可推进：

1. **DSH 在 Platform 发行包里的实际落位**：`rpm -ql` / `dpkg -L` 输出，或 agent-os Server bundle 的目录树。
2. **DSH 的启动方式**：systemd unit、CLI 子命令或 Client 内嵌，附执行用户与 `DSH_HOME`。
3. **Manager 对 DSH 的供给 schema**：字段名、密钥引用形式、是否支持热更新。
4. **网关对 `/v1/chat/completions` 的处理规则**：是否透传未知字段、是否允许空 `messages`。

拿到 1 和 2 即可推进 P4/P5；拿到 4 才能做 P6 的路由验收。

---

## 6. 本轮不改变的事实

- 插件的数据面与管理面**统一走 `/v1/chat/completions`**（与上游实现对齐后的结论），不存在「数据面走 Messages」的旧路径依赖。
- 引擎侧不需要任何补丁：原厂镜像的 chat 入口已声明 `agent_hint`。
- 插件保持零配置：`llm-deepseek` 提供连接，插件条目留空。

---

## 7. 本轮实际完成范围

Core/DSH 拆分不依赖 Platform，已独立推进：

- 新增 `packages/agenthint-core`，零外部依赖（无 DSH、无 Cordis、无 React）。
- DSH 侧保留原包名、provider、配置与全部公共导出，行为不变。
- 测试从 152 项增至 169 项，原 152 项全部保持通过。

Platform 侧的构建、配置供给与路由验收**未执行**，按 GAP 处理。
