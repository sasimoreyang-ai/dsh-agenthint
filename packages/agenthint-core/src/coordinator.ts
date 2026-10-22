/**
 * Session-scoped control queue, bounded barriers and ordinary-request leases.
 *
 * The coordinator owns every piece of cross-request state that makes the
 * protocol safe:
 *
 * - a per-session queue so a cache mutation never races new inference;
 * - a barrier that turns a pending or unknown mutation into a stable
 *   `CONTROL_BARRIER` failure instead of a retryable transport error;
 * - a full-stream lease so `pause`/`stop` wait for the model stream to end;
 * - quarantine of sessions whose mutation outcome is unknown, which survives
 *   disposal and reopen until an operator resolves it.
 *
 * It knows nothing about any host: sessions are plain strings, requests are
 * classified by the host, and control commands leave through a
 * {@link ControlTransport}. Cross-session policy — such as which session the
 * foreground moved away from — belongs to the adapter, because that policy is
 * meaningful only inside one host's interaction model.
 *
 * @module agenthint-core/coordinator
 */

import { AgentHintError, controlBarrierError } from './errors.ts'
import { buildAgentHint } from './hint.ts'
import type { HintInputs } from './hint.ts'
import type {
  ControlIntent, ControlResult, ControlTransport, WarnSink,
} from './transport.ts'
import type {
  AgentHintCacheControl, AgentHintWire, ControlVerb, RequestClass,
} from './types.ts'

/** Default bound on how long a request waits for an in-flight mutation. */
export const DEFAULT_PENDING_OP_AWAIT_MS = 2_000
/** Default cool-down before a failed advisory prefetch may be re-requested. */
export const DEFAULT_RESUME_COOLDOWN_MS = 1_000

/** Facts a host supplies when it learns a session exists. */
export interface SessionFacts {
  /** Host-side session identity, already namespaced by the host's own scope. */
  sessionId: string
  /** Whether the session was created with prior history (resume/fork/replay). */
  seeded: boolean
  /** Identity of the session this one continues, when the host knows it. */
  parentSessionId?: string | undefined
}

/** Read-only lifecycle view a host needs to build a hint. */
export interface SessionFactsView {
  seeded: boolean
  firstOrdinarySent: boolean
  parentSessionId: string | undefined
}

/** Per-request facts a host supplies before it serialises a model call. */
export interface RequestFacts {
  /** Session identity; `undefined` requests stay unprefixed and unqueued. */
  sessionId?: string | undefined
  /** Host classification of the call. */
  requestClass: RequestClass
  /** The real model this request targets. */
  model: string
  /** Caller cancellation. */
  signal?: AbortSignal | undefined
  /** Static cache policy copied verbatim into every hint. */
  cacheControl?: AgentHintCacheControl | undefined
}

/** Coordinator options. Every external effect is injectable for testing. */
export interface HintCoordinatorOptions {
  /** Where control commands go. */
  transport: ControlTransport
  /** Bound on the mutation barrier; defaults to {@link DEFAULT_PENDING_OP_AWAIT_MS}. */
  pendingOpAwaitMs?: number
  /** Cool-down after an advisory prefetch failure. */
  resumeCooldownMs?: number
  /** Non-fatal diagnostics. */
  warn?: WarnSink
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

/** Handle for one in-flight ordinary request. */
export interface RequestLease {
  /** Wire field to merge into the request body, when the request carries one. */
  hint?: AgentHintWire | undefined
  /**
   * Commit the `start` bookkeeping. Call exactly once, at the point the host
   * knows the request was accepted — never during preparation.
   */
  accepted(): void
  /**
   * Release the stream lease. Idempotent; must run on every terminal path
   * (completion, error, cancellation, abandoned iterator).
   */
  finish(): void
}

interface SessionState {
  archived: boolean
  seeded: boolean
  resumeSent: boolean
  resumeAttempt: object
  nextResumeAt: number
  idle: boolean
  pausePending: boolean
  pauseSent: boolean
  firstOrdinarySent: boolean
  parentSessionId: string | undefined
  lastModel: string | undefined
  pendingOp: Promise<void> | undefined
  mutations: number
  unsafe: boolean
  generation: number
  incarnation: object
  active: number
  /** Preparations that have not yet been accepted or finished. */
  preparing: number
  dataIdle: Promise<void> | undefined
  releaseData: (() => void) | undefined
}

function freshState(): SessionState {
  return {
    archived: false, seeded: false, resumeSent: false, resumeAttempt: {}, nextResumeAt: 0,
    idle: true, pausePending: false, pauseSent: false, firstOrdinarySent: false,
    parentSessionId: undefined, lastModel: undefined, pendingOp: undefined, mutations: 0,
    unsafe: false, generation: 0, incarnation: {}, active: 0, preparing: 0,
    dataIdle: undefined, releaseData: undefined,
  }
}

/**
 * Coordinates AgentHint control state for one trust scope.
 *
 * Create one instance per isolated interaction scope (single-user runtime,
 * one workspace, one agent instance). Sharing one instance across users would
 * let one user's traffic pause another user's session, so hosts that serve
 * several scopes must hold several coordinators.
 */
export class HintCoordinator {
  private readonly states = new Map<string, SessionState>()
  private disposed = false
  private readonly lifetime = new AbortController()
  private readonly pendingOpAwaitMs: number
  private readonly resumeCooldownMs: number
  private readonly now: () => number

  constructor(private readonly options: HintCoordinatorOptions) {
    this.pendingOpAwaitMs = options.pendingOpAwaitMs ?? DEFAULT_PENDING_OP_AWAIT_MS
    this.resumeCooldownMs = options.resumeCooldownMs ?? DEFAULT_RESUME_COOLDOWN_MS
    this.now = options.now ?? (() => Date.now())
  }

  /** Aborted when the coordinator is disposed. */
  get signal(): AbortSignal { return this.lifetime.signal }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean { return this.disposed }

  /**
   * Stop all work. Cancels waits and in-flight sends; no new control command is
   * produced afterwards. Outstanding uncertainty is intentionally not cleared:
   * a disposed coordinator must not be read as "the backend is safe".
   */
  dispose(): void {
    this.disposed = true
    this.lifetime.abort()
    for (const state of this.states.values()) state.releaseData?.()
    this.states.clear()
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Record that a session exists.
   *
   * Outstanding operations and uncertainty are deliberately preserved across a
   * disposal/reopen cycle: a reopened session must not look safe just because
   * its previous incarnation ended.
   */
  registerSession(facts: SessionFacts): void {
    if (this.disposed) return
    const state = this.state(facts.sessionId)
    state.incarnation = {}
    state.seeded = facts.seeded
    state.firstOrdinarySent = false
    state.resumeSent = false
    state.resumeAttempt = {}
    state.idle = true
    state.pausePending = false
    state.pauseSent = false
    state.parentSessionId = facts.parentSessionId
  }

  /** Report whether the host considers this session idle (no turn in flight). */
  setAgentIdle(sessionId: string, idle: boolean): void {
    if (this.disposed) return
    const state = this.state(sessionId)
    state.idle = idle
    if (idle) this.maybePauseIfIdle(sessionId)
  }

  /** Mark a session archived; a later disposal must not send a second stop. */
  setArchived(sessionId: string, archived: boolean): void {
    const state = this.states.get(sessionId)
    if (state !== undefined) state.archived = archived
  }

  /** Drop a session whose lifecycle ended before it ever carried a request. */
  forgetSession(sessionId: string): void {
    const state = this.states.get(sessionId)
    if (state?.lastModel === undefined) this.states.delete(sessionId)
  }

  /** Read the lifecycle facts a host needs to build a hint. */
  facts(sessionId: string | undefined): SessionFactsView {
    const state = sessionId === undefined ? undefined : this.states.get(sessionId)
    return {
      seeded: state?.seeded ?? false,
      firstOrdinarySent: state?.firstOrdinarySent ?? false,
      parentSessionId: state?.parentSessionId,
    }
  }

  /** Model last used by this session, when the coordinator has seen one. */
  lastModelOf(sessionId: string): string | undefined {
    return this.states.get(sessionId)?.lastModel
  }

  /** Whether the host marked this session archived. */
  isArchived(sessionId: string): boolean {
    return this.states.get(sessionId)?.archived ?? false
  }

  // -------------------------------------------------------------- request path

  /**
   * Wait out any in-flight cache mutation for this session.
   *
   * Bounded and fail-open for the advisory path: when the cap expires the
   * caller continues unless a mutating verb is still outstanding or the
   * session is already quarantined, in which case the barrier is raised.
   *
   * @throws AgentHintError `CONTROL_BARRIER` when the session cannot safely proceed.
   */
  async awaitPendingOp(sessionId: string | undefined, signal?: AbortSignal): Promise<void> {
    const state = sessionId === undefined ? undefined : this.states.get(sessionId)
    if (state === undefined) return
    const combined = signal === undefined ? this.signal : AbortSignal.any([signal, this.signal])
    combined.throwIfAborted()
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const deadline = new Promise<'expired'>((resolve, reject) => {
      timer = setTimeout(() => resolve('expired'), this.pendingOpAwaitMs)
      onAbort = () => reject(combined.reason)
      combined.addEventListener('abort', onAbort, { once: true })
    })
    try {
      while (state.pendingOp !== undefined) {
        const pending = state.pendingOp
        if (await Promise.race([pending, deadline]) === 'expired') {
          this.options.warn?.('agenthint-core: control barrier timed out; backend outcome remains unknown')
          if (state.mutations > 0 || state.unsafe) throw controlBarrierError()
          return
        }
      }
      if (state.unsafe) throw controlBarrierError()
    } finally {
      clearTimeout(timer)
      if (onAbort !== undefined) combined.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Reserve the stream slot for one ordinary request.
   *
   * Holds cache mutations until the returned release function runs, so a
   * `pause`/`stop` can never overtake an in-flight model stream. There is no
   * await between checking the mutation queue and reserving the slot, which is
   * what makes the exclusion real rather than best-effort.
   *
   * @throws AgentHintError `CONTROL_BARRIER` when the session cannot safely proceed.
   */
  async beginOrdinary(
    sessionId: string | undefined, model: string, signal?: AbortSignal,
  ): Promise<() => void> {
    this.signal.throwIfAborted()
    signal?.throwIfAborted()
    if (sessionId === undefined) return () => {}
    this.ensureResume(sessionId, model)
    await this.awaitPendingOp(sessionId, signal)
    this.signal.throwIfAborted()
    signal?.throwIfAborted()
    const state = this.state(sessionId)
    if (state.mutations > 0 || state.unsafe) throw controlBarrierError()
    state.generation++
    // Keep the state associated with this lease even if disposal races acceptance.
    state.lastModel = model
    if (state.active++ === 0) state.dataIdle = new Promise(resolve => { state.releaseData = resolve })
    let released = false
    return () => {
      if (released) return
      released = true
      if (--state.active === 0) { state.releaseData?.(); state.releaseData = undefined; state.dataIdle = undefined }
    }
  }

  /**
   * Commit the bookkeeping for an accepted ordinary request.
   *
   * Only call this once the transport confirms the request was accepted, so a
   * rejected request does not consume the session's single `start`.
   */
  noteOrdinaryRequest(sessionId: string | undefined, model: string): void {
    if (sessionId === undefined || this.disposed) return
    const state = this.state(sessionId)
    state.archived = false
    state.firstOrdinarySent = true
    state.lastModel = model
    state.pausePending = false
    state.pauseSent = false
  }

  /**
   * Prepare one request end to end and return its lease.
   *
   * Convenience wrapper for hosts that hold a single hook: it performs the
   * barrier, builds the hint from current facts, and wires `accepted`/`finish`
   * to the bookkeeping above. Hosts with separate prepare and stream hooks (so
   * the lease must outlive preparation) should call
   * {@link beginOrdinary} and {@link buildHint} themselves.
   */
  async prepareRequest(facts: RequestFacts): Promise<RequestLease> {
    const sessionId = facts.sessionId
    const ordinary = facts.requestClass === 'ordinary'
    const state = sessionId === undefined ? undefined : this.state(sessionId)
    // Single-writer contract: two overlapping preparations on a session that has
    // not yet declared `start` would both claim the verb. Reject the second one
    // rather than let the backend see two competing first requests. Stream
    // leases stay concurrent; only the hint declaration is single-writer.
    if (ordinary && state !== undefined && !state.firstOrdinarySent && state.preparing > 0) {
      throw new AgentHintError(
        'AgentHint: another ordinary request is already preparing this session; '
        + 'a session admits one unaccepted first request at a time.',
        'INVALID_INPUT',
      )
    }
    const release = ordinary
      ? await this.beginOrdinary(sessionId, facts.model, facts.signal)
      : () => {}
    if (ordinary && state !== undefined) state.preparing++
    const hint = this.buildHint(facts)
    let accepted = false
    let settled = false
    const settlePreparation = (): void => {
      if (settled) return
      settled = true
      if (ordinary && state !== undefined && state.preparing > 0) state.preparing--
    }
    return {
      hint,
      accepted: () => {
        if (accepted) return
        accepted = true
        if (ordinary) this.noteOrdinaryRequest(sessionId, facts.model)
        settlePreparation()
      },
      finish: () => {
        release()
        settlePreparation()
      },
    }
  }

  /** Build the wire field for one request from current session facts. */
  buildHint(facts: RequestFacts): AgentHintWire | undefined {
    const view = this.facts(facts.sessionId)
    const inputs: HintInputs = {
      sessionId: facts.sessionId,
      requestClass: facts.requestClass,
      parentSessionId: view.parentSessionId,
      cacheControl: facts.cacheControl,
      seeded: view.seeded,
      firstOrdinarySent: view.firstOrdinarySent,
    }
    return buildAgentHint(inputs)
  }

  // ------------------------------------------------------------------ control

  /**
   * Ask for an advisory prefetch, at most once per pause cycle.
   *
   * Advisory means a failure is not fatal: the request may proceed, but the
   * caller must not report the prefetch as completed.
   */
  ensureResume(sessionId: string | undefined, model: string): void {
    if (sessionId === undefined || this.disposed) return
    const state = this.states.get(sessionId)
    if (state === undefined || !(state.seeded || state.pauseSent) || state.resumeSent
      || state.unsafe || this.now() < state.nextResumeAt) return
    state.resumeSent = true
    state.resumeAttempt = {}
    state.lastModel = model
    void this.track(sessionId, 'resume', model)
  }

  /**
   * Defer a `pause` until the session is idle.
   *
   * The host decides *when* the foreground moved away; this method decides
   * *when it is safe to send*, which is the part that needs the queue.
   */
  requestPause(sessionId: string, model?: string): void {
    const state = this.states.get(sessionId)
    if (state === undefined || state.pauseSent || state.pausePending) return
    state.pausePending = true
    if (model !== undefined) state.lastModel = model
    this.maybePauseIfIdle(sessionId)
  }

  /**
   * Send one mutating or advisory verb immediately through the session queue.
   *
   * Mutating verbs (`pause`, `compact`, `stop`) are never retried and a
   * `cancelled` result that already left the process counts as an unknown
   * outcome. Only `resume` retries, and only on an explicit transient
   * rejection.
   */
  requestControl(intent: ControlIntent): Promise<ControlResult> {
    if (this.disposed) return Promise.resolve({ status: 'cancelled', dispatched: false })
    const state = this.states.get(intent.sessionId)
    if (state === undefined) return Promise.resolve({ status: 'cancelled', dispatched: false })
    if (state.lastModel === undefined && intent.model === undefined) {
      return Promise.resolve({ status: 'cancelled', dispatched: false })
    }
    return this.track(intent.sessionId, intent.verb, intent.model)
  }

  /** Send a terminal `stop`, then drop the state once it settles safely. */
  releaseSession(sessionId: string): void {
    const state = this.states.get(sessionId)
    if (state?.lastModel === undefined) { this.states.delete(sessionId); return }
    const incarnation = state.incarnation
    const pending = state.archived
      ? state.pendingOp ?? Promise.resolve()
      : this.track(sessionId, 'stop', state.lastModel)
    void pending.then(() => {
      // Unknown mutation outcomes remain quarantined even if the session reopens.
      if (this.states.get(sessionId) === state && state.incarnation === incarnation && !state.unsafe) {
        this.states.delete(sessionId)
      }
    })
  }

  /** Archive a session: stop it once, and make a later disposal a no-op. */
  archiveSession(sessionId: string): void {
    const state = this.states.get(sessionId)
    if (state?.lastModel === undefined || state.archived) return
    state.archived = true
    state.pausePending = false
    state.pauseSent = true
    state.resumeSent = false
    void this.track(sessionId, 'stop', state.lastModel)
  }

  // ------------------------------------------------------------------ internals

  private maybePauseIfIdle(sessionId: string): void {
    const state = this.states.get(sessionId)
    if (state === undefined || !state.pausePending || !state.idle) return
    state.pausePending = false
    state.pauseSent = true
    state.resumeSent = false
    void this.track(sessionId, 'pause', state.lastModel)
  }

  private state(sessionId: string): SessionState {
    let state = this.states.get(sessionId)
    if (state === undefined) {
      state = freshState()
      this.states.set(sessionId, state)
    }
    return state
  }

  private track(sessionId: string, verb: ControlVerb, model?: string): Promise<ControlResult> {
    if (this.disposed) return Promise.resolve({ status: 'cancelled', dispatched: false })
    const state = this.state(sessionId)
    const generation = state.generation
    const resumeAttempt = state.resumeAttempt
    const mutating = verb !== 'resume'
    if (mutating) state.mutations++
    const canSend = () => !this.disposed && !state.unsafe && state.generation === generation
    const dispatch = (): Promise<ControlResult> => canSend()
      ? this.options.transport.send({
        verb, sessionId, model: model ?? state.lastModel ?? 'default', signal: this.signal, canSend,
      })
      : Promise.resolve<ControlResult>({ status: 'cancelled', dispatched: false })
    const dependencies = [state.pendingOp, state.dataIdle].filter((value): value is Promise<void> => value !== undefined)
    const promise = dependencies.length === 0 ? dispatch() : Promise.all(dependencies).then(dispatch)
    const settled = promise.then((result): ControlResult => {
      if (mutating && (result.status === 'unknown' || (result.status === 'cancelled' && result.dispatched))) {
        state.unsafe = true
      }
      // A prefetch can fail after the advisory barrier already let data start.
      // Its own attempt identity, rather than the data generation, owns recovery.
      if (verb === 'resume' && state.resumeAttempt === resumeAttempt
        && (result.status === 'failed' || (result.status === 'cancelled' && !result.dispatched))) {
        state.resumeSent = false
        state.nextResumeAt = this.now() + this.resumeCooldownMs
      }
      return result
    }, (error): ControlResult => {
      if (mutating) state.unsafe = true
      this.options.warn?.('agenthint-core: control operation failed', error)
      return { status: 'failed', retryable: false }
    })
    const tracked: Promise<void> = settled.then(() => {}, () => {}).finally(() => {
      if (mutating) state.mutations--
      if (state.pendingOp === tracked) state.pendingOp = undefined
    })
    state.pendingOp = tracked
    return settled
  }
}

/** Re-exported so adapters can branch on the barrier without importing errors. */
export { AgentHintError }
