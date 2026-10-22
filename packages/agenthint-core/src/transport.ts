/**
 * Control-plane transport contract.
 *
 * The coordinator only depends on this interface, never on `fetch`, a host
 * HTTP client, or a credential store. Implementations decide how a command is
 * authenticated and where it is sent; the state machine decides when sending
 * is safe.
 *
 * @module agenthint-core/transport
 */

import type { ControlVerb } from './types.ts'

/**
 * Outcome of one control attempt.
 *
 * `accepted` means the endpoint returned a success status **and** the body was
 * read. It does not mean the backend finished the cache action — completion is
 * observed separately by the backend, never inferred from HTTP.
 */
export type ControlResult =
  | { status: 'accepted'; httpStatus: number }
  | { status: 'failed'; retryable: boolean; httpStatus?: number }
  | { status: 'unknown' }
  | { status: 'cancelled'; dispatched: boolean }

/** One control command handed to a transport. */
export interface ControlCommand {
  /** Verb to send. `start` is rejected before it reaches a transport. */
  verb: ControlVerb
  /** Target session identity. */
  sessionId: string
  /** Model to name in the manage request. */
  model: string
  /** Aborted when the coordinator is disposed or the caller gives up. */
  signal?: AbortSignal
  /**
   * Re-checked immediately before dispatch. Lets the coordinator abandon a
   * queued command whose session generation moved on while it waited.
   */
  canSend: () => boolean
}

/** Sink for non-fatal diagnostics; hosts usually forward this to their logger. */
export interface WarnSink { (message: string, error?: unknown): void }

/** Pluggable control transport. */
export interface ControlTransport {
  /** Send exactly one command. Must not retry internally beyond documented rules. */
  send(command: ControlCommand): Promise<ControlResult>
}

/** Why the host asked for a control verb; carried through for diagnostics only. */
export type ControlReason =
  /** The host moved its foreground elsewhere and this session can be released. */
  | 'foreground-switched'
  /** The host observed a durable compaction. */
  | 'compaction-committed'
  /** The host observed a real end of life for this session. */
  | 'session-archived'
  | 'session-disposed'
  /** The host expects this session to be used again soon. */
  | 'session-resumed'

/** A control request raised by the host adapter. */
export interface ControlIntent {
  /** Verb to request. `start` is not a valid intent; it rides a request lease. */
  verb: Exclude<ControlVerb, 'start'>
  /** Target session identity. */
  sessionId: string
  /** Model to name in the manage request. */
  model: string
  /** Why the host asked; diagnostics only, never affects semantics. */
  reason?: ControlReason
}
