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

/** Recursive JSON value; the only structural vocabulary the wire contract uses. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** A JSON object with no host-specific value types. */
export interface JsonObject { [key: string]: JsonValue }

/**
 * One session lifecycle control verb.
 *
 * Coordinator translation: `pause`→offload, `stop`→evict, `compact`→evict,
 * `resume`→prefetch; `start` only declares liveness and must ride an ordinary
 * request rather than a standalone manage request.
 */
export type ControlVerb = 'start' | 'pause' | 'resume' | 'compact' | 'stop'

/** Backwards-compatible alias for the historical DSH-facing name. */
export type SessionControlVerb = ControlVerb

/**
 * How a host classifies one model request.
 *
 * Only `ordinary` requests participate in session identity and lifecycle
 * bookkeeping. `background` covers titles, summaries and any other auxiliary
 * call that must not perturb the live session's KV-cache identity.
 */
export type RequestClass = 'ordinary' | 'background'

/** Coordinator-side cache policy hint, passed through verbatim. */
export interface AgentHintCacheControl {
  /** Policy type discriminator the coordinator dispatches on (e.g. `default`). */
  type: string
  /** Additional policy fields, passed through verbatim. */
  [key: string]: JsonValue
}

/** The `agent_hint` wire object merged into model requests. */
export interface AgentHintWire {
  /** Stable session identity the coordinator keys KV-cache state on. */
  session_id: string
  /** Identity of the compacted-away session this one continues. */
  parent_session_id?: string
  /** Coordinator-side cache policy hint. */
  cache_control?: AgentHintCacheControl
  /** Session lifecycle control request; one verb per request. */
  session_control?: { type: ControlVerb }
}
