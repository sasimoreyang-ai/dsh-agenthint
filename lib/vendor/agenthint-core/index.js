/**
 * AgentHint Core — host-neutral protocol, state machine and control contracts.
 *
 * This package contains everything about the AgentHint protocol that does not
 * depend on a particular agent host: the wire shapes, the pure hint builder,
 * the per-session control queue and barriers, the error vocabulary, and the
 * control transport contract.
 *
 * It deliberately imports nothing from any agent framework, UI toolkit or
 * cloud SDK. A host adapter supplies session identity, request classification,
 * credentials and a transport; the core supplies the rules that keep cache
 * mutations from racing inference.
 *
 * ```ts
 * import { HintCoordinator, buildAgentHint } from '@sasimoreyang-ai/agenthint-core'
 * import { HttpControlTransport } from '@sasimoreyang-ai/agenthint-core/http'
 * ```
 *
 * @module agenthint-core
 */
export { AgentHintError, CONTROL_BARRIER_MESSAGE, controlBarrierError, isAgentHintError, } from "./errors.js";
export { assertJsonValue, assertValidCacheControl, buildAgentHint } from "./hint.js";
export { DEFAULT_PENDING_OP_AWAIT_MS, DEFAULT_RESUME_COOLDOWN_MS, HintCoordinator, } from "./coordinator.js";
