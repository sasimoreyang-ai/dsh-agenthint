# DSH AgentHint 中文文档

完整中文文档位于 [README.md](README.md)，包含安装、配置、生命周期、验证和限制。[English](README.en.md)

## Hint trace

默认开启适配器 Hint trace。记录同时写入**原 DSH 会话日志**（`session.v4.jsonl`，每次 attempt 一条终态记录）与**服务端 stdout**（含中间态）。会话日志使用 DSH 0.2.2 的 `appendPluginRecord` 通道（记录 `ignorable`、不进模型可见 surface、随 fork/resume 携带），该 API 文档限定实验包使用，属于已知取舍。`agentHint.trace.writeToSession: false` 可只保留 stdout 与进程内窗口。详见 [Hint trace](docs/trace.md)。
