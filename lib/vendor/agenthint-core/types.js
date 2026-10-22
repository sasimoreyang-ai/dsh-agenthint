/**
 * Wire types for the `agent_hint` request field and the host-neutral request
 * vocabulary the coordinator reasons about.
 *
 * The shapes mirror the MindIE-Motor coordinator's `agent_hint_rfc.md` and
 * `session_control_rfc.md` design notes. The coordinator — not this package —
 * translates control verbs into `context_management` manage requests.
 *
 * This module must stay free of host imports: it uses its own recursive JSON
 * type so that consumers never inherit a dependency on any particular agent
 * framework.
 *
 * @module agenthint-core/types
 */
export {};
