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
export type { AgentHintCacheControl, AgentHintWire, ControlVerb, JsonObject, JsonValue, RequestClass, SessionControlVerb, } from './types.ts';
export { AgentHintError, CONTROL_BARRIER_MESSAGE, controlBarrierError, isAgentHintError, } from './errors.ts';
export type { AgentHintErrorCode } from './errors.ts';
export { assertJsonValue, assertValidCacheControl, buildAgentHint } from './hint.ts';
export type { HintInputs } from './hint.ts';
export type { ControlCommand, ControlIntent, ControlReason, ControlResult, ControlTransport, WarnSink, } from './transport.ts';
export { DEFAULT_PENDING_OP_AWAIT_MS, DEFAULT_RESUME_COOLDOWN_MS, HintCoordinator, } from './coordinator.ts';
export type { HintCoordinatorOptions, RequestFacts, RequestLease, SessionFacts, SessionFactsView, } from './coordinator.ts';
