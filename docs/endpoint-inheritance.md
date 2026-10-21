# 端点继承：让 standalone 模式不再需要手填地址

日期：2026-10-21；宿主基线：npm DSH 0.2.0-rc.1。

## 问题

`mode: standalone` 提供完整控制面（`start`/`pause`/`resume`/`stop`），但需要三项配置：

```yaml
- id: llm-agent-hint
  config:
    mode: standalone
    provider: deepseek-agent-hint
    baseURL: http://192.168.41.153:1025   # 协调器地址
    models:                                # 模型列表
      - id: DeepSeek-V4-Flash
```

其中 `baseURL` 对普通用户不可行：

1. **DSH 的设置页不提供第三方插件的配置表单。** `dsh-client-ui-settings-models` 的 `layoutOf` 只识别 `llm-deepseek` 与 `llm-pi-ai` 两个 namespace，其余一律 `unknown`，渲染出的是一句提示：`其余字段在 cordis.patch.yml 中，请直接编辑对应段。`
2. **手写 YAML 对非开发者门槛过高。** 缩进错误会导致 profile 无法加载，而报错信息面向开发者。
3. **地址本身无法被插件猜出。** 插件运行在用户机器，协调器运行在服务器，两者之间没有任何自动发现通道。

## 观察

**能用一个模型的人，必然已经配好了端点。**

DSH 要能用，用户必然已经配置了某个 DeepSeek 兼容路由（`llm-deepseek`），其中有 `baseURL` 和 `models`。这两项恰好就是本插件需要的。

所以不需要问用户，**去读已有路由的配置即可**。

## 实现

### 读取来源

`ConfigEditor.configuration()` 返回每个 Loader 条目的 `inherited` 与 `override` 两层配置：

```ts
interface ConfigurationRow {
  entry: { options?: { id?: string } }
  inherited: Record<string, unknown>
  override: Record<string, unknown>
}
```

合并两层后读取 `baseURL` 与 `models`，来源条目 id 为 `llm-deepseek`（`INHERIT_SOURCE_ID`）。

见 `src/inherited-connection.ts`。

### 优先级链

`resolveBaseURL` 按固定顺序取值：

| 顺序 | 来源 | 说明 |
|---|---|---|
| 1 | 显式配置 | 值不等于内置默认值即视为操作者选择，永远优先 |
| 2 | 继承路由 | 从 `llm-deepseek` 读到的端点 |
| 3 | 环境变量 | `DSH_AGENT_HINT_BASE_URL` |
| 4 | 内置默认 | `http://127.0.0.1:1025` |

模型目录同理：显式配置 > 继承路由 > 空。

### 缓存与失效

`options()` 每个请求调用一次，因此继承结果在首次读到后缓存。两处细节：

- **只在编辑器服务挂载后才固定缓存。** 插件激活时 `configEditor` 可能尚未就绪，过早缓存会冻结一个空结果。
- **`loader/volatile-update` 时清空缓存。** 用户改了 `llm-deepseek` 的地址后，本插件下一次请求即读到新值，无需重启。

## 覆盖范围

| 场景 | 是否需要手配 | 走哪条 |
|---|---|---|
| 用户已有可用 DeepSeek 路由 | **不需要** | 继承 |
| 部署脚本设了环境变量 | 不需要 | 环境变量 |
| 协调器与 DSH 同机、默认端口 | 不需要 | 内置默认 |
| 以上都不满足 | 需要 | 显式配置 |

前三种合起来覆盖了「已经能用 DSH」的绝大多数部署。

## 边界

- **继承的是端点与模型目录，不继承凭据。** 本插件默认不发送 `authorization`；协调器若需要鉴权，仍须配置 `apiKeyEnv`。
- **继承不改变路由归属。** 本插件仍注册自己的 provider `deepseek-agent-hint`，与源路由并存，互不影响。
- **源路由不存在时静默回退。** 没有 `llm-deepseek` 条目、编辑器抛错、字段类型不符，全部返回空结果，不报错。
- **`mode: inherit` 不受影响。** 该模式本就不注册 provider，不读取端点。

## 验证

`tests/inherited-connection.spec.ts` 覆盖：

| 用例 | 断言 |
|---|---|
| 显式配置优先 | 与继承值不同时取显式值 |
| 继承生效 | 配置为默认值时取继承值 |
| 环境变量兜底 | 无继承时取环境变量 |
| 继承优先于环境变量 | 两者都在时取继承值 |
| 空值忽略 | 空字符串不覆盖默认值 |
| 模型目录继承 | 空配置时取继承目录 |
| 继承目录被复制 | 调用方修改不影响源对象 |
| 服务缺失 | 返回空，不抛错 |
| 条目缺失 | 返回空 |
| 编辑器抛错 | 返回空，不抛错 |
| 字段类型错误 | 丢弃非法值 |

全部 87 项测试通过（12 个测试文件）。

## 未覆盖

- 真机上「用户从未配置过任何模型」的场景：此时继承无源可读，仍需显式配置或环境变量。这属于部署前提，不是插件可以消除的。
- `docs/zero-config.md` 中记录的 `session id None` 现象与本改动无关，属引擎侧会话挂载问题，另行跟踪。
