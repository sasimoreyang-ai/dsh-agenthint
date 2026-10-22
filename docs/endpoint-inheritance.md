# 有效配置继承

适用：0.6.0-rc.1 / DSH 0.2.0-rc.1。实现：`src/config.ts`、`src/inherited-connection.ts`、`src/index.ts`。

## 实际来源

每次解析读取公开Loader条目，要求来源id为`llm-deepseek`、唯一、未禁用、已激活。从其有效fiber配置读取volatile引用并经官方协议resolver处理，包含schema默认目录与生成设置。没有Loader时才兼容ConfigEditor原始层，并经官方schema校验。非法源配置显式报错；缺失/未激活/重复来源不贡献配置。

不缓存继承结果；全局volatile更新与源生命周期变化刷新目录注册。每个prepared请求固定自己的设置，不因热更新混用另一代端点和鉴权引用。源端点更换不迁移已有KV会话，管理员应排空请求后新建会话。

## 优先级

显式插件参数优先，省略时继承源实际值，再使用协议默认值。显式localhost和空模型目录都受尊重。地址没有来源时再读`DSH_AGENT_HINT_BASE_URL`，最后localhost:1025。无来源和显式模型则目录为空。

`transport`、provider和AgentHint策略属于本插件，不由源路由决定。Chat最终模型信息提供真实上下文容量、输出上限、thinking/effort默认值和重试策略，同时声明文本输入能力。

## 凭据

只继承引用，不把密钥写回配置。最终模型端点与源完整URL相同（忽略末尾斜线）、没有显式引用且未禁用inheritCredentials时才继承。继承引用使用`x-api-key`匹配官方API-key路由；显式插件引用保留Bearer。

请求时从credentials服务解析引用；该服务不存在时读取启动环境。显式引用缺失报MISSING_CREDENTIAL。源默认DEEPSEEK_API_KEY可能在无鉴权本地协调器上不存在，所以继承引用缺失时不发送凭据；受保护后端仍可以返回AUTH错误。

有凭据引用且控制origin不同于模型origin时拒绝控制，不转发密钥。独立控制凭据不在当前配置范围内。数据与控制请求均拒绝重定向；管理员须配置最终可信地址。共享密钥引用的轮换仍由credentials服务管理，跨端点迁移应使用各自的引用并协调在途请求。

## 验证

真实Loader测试覆盖：源A→B、默认目录、删除/重加/禁用/恢复、显式覆盖与凭据退出继承。Chat prepared-call回归覆盖端点/引用同一代快照，stock AgentLoop集成覆盖继承后的实际HTTP字段。
