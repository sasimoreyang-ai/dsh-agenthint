/**
 * Host-neutral error vocabulary.
 *
 * The core never throws a host error type: adapters map these codes onto
 * whatever their runtime uses. `CONTROL_BARRIER` in particular must never be
 * downgraded into a generic transport failure, because hosts commonly retry
 * transport failures and a retried mutation can duplicate a cache action whose
 * outcome is already unknown.
 *
 * @module agenthint-core/errors
 */

/** Stable, documented failure codes. Adding a code is a breaking change. */
export type AgentHintErrorCode =
  /** A cache-changing control is pending or has an unknown outcome. */
  | 'CONTROL_BARRIER'
  /** The caller supplied facts that cannot produce a valid hint. */
  | 'INVALID_INPUT'
  /** The coordinator was disposed and no longer accepts work. */
  | 'DISPOSED'

/** Error raised by the core; adapters translate the code, not the message. */
export class AgentHintError extends Error {
  /** Stable machine-readable discriminator. */
  readonly code: AgentHintErrorCode

  constructor(message: string, code: AgentHintErrorCode) {
    super(message)
    this.name = 'AgentHintError'
    this.code = code
  }
}

/** Narrow an unknown value to an {@link AgentHintError} without a cast. */
export function isAgentHintError(value: unknown): value is AgentHintError {
  return value instanceof AgentHintError
}

/** Message text for the barrier, kept in one place so hosts can reuse it. */
export const CONTROL_BARRIER_MESSAGE =
  'AgentHint: a cache-changing control is pending or has an unknown outcome; '
  + 'this session cannot safely start another request. Check the coordinator before continuing.'

/** Construct the barrier error. */
export function controlBarrierError(): AgentHintError {
  return new AgentHintError(CONTROL_BARRIER_MESSAGE, 'CONTROL_BARRIER')
}
