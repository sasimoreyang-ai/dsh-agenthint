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
/** Error raised by the core; adapters translate the code, not the message. */
export class AgentHintError extends Error {
    /** Stable machine-readable discriminator. */
    code;
    constructor(message, code) {
        super(message);
        this.name = 'AgentHintError';
        this.code = code;
    }
}
/** Narrow an unknown value to an {@link AgentHintError} without a cast. */
export function isAgentHintError(value) {
    return value instanceof AgentHintError;
}
/** Message text for the barrier, kept in one place so hosts can reuse it. */
export const CONTROL_BARRIER_MESSAGE = 'AgentHint: a cache-changing control is pending or has an unknown outcome; '
    + 'this session cannot safely start another request. Check the coordinator before continuing.';
/** Construct the barrier error. */
export function controlBarrierError() {
    return new AgentHintError(CONTROL_BARRIER_MESSAGE, 'CONTROL_BARRIER');
}
