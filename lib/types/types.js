/**
 * Wire types for the `agent_hint` request field consumed by MindIE-Motor
 * coordinators: stable session identity for KV-cache reuse, parent linkage
 * for compaction continuations, cache policy, and the session lifecycle
 * control verbs. The shapes mirror the coordinator's `agent_hint_rfc.md`
 * and `session_control_rfc.md` design notes; the coordinator — not this
 * package — translates control verbs into `context_management` manage
 * requests.
 *
 * @module dsh-llm-agent-hint/types
 */
export {};
