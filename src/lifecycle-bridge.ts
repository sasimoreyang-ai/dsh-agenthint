/**
 * DSH adapter over the host-neutral coordinator.
 *
 * The queue, the barrier, the stream lease and the unknown-mutation quarantine
 * all live in `@sasimoreyang-ai/agenthint-core`. This module supplies the three
 * things only DSH can know:
 *
 * 1. **Event mapping** — which DSH events mean "the user moved away", "the
 *    compaction committed", "the session really ended".
 * 2. **Scope-local foreground tracking** — `lastOrdinarySessionId` decides which
 *    session to pause when the user switches chats. It is intentionally held
 *    here, not in the core: a shared runtime must not let one user's traffic
 *    pause another user's session, so each host scope owns its own instance.
 * 3. **Error translation** — the core raises `AgentHintError`; DSH callers
 *    expect `LlmError` with the `CONTROL_BARRIER` code, which must never be
 *    downgraded into a retryable transport failure.
 *
 * @module dsh-llm-agent-hint/lifecycle-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as toSessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type {} from './host-events.ts'
import { LlmError } from '@deepseek-ai/dsh-llm'
import {
  CONTROL_BARRIER_MESSAGE,
  DEFAULT_PENDING_OP_AWAIT_MS,
  HintCoordinator,
  isAgentHintError,
} from '@sasimoreyang-ai/agenthint-core'
import type { ControlResult, SessionControlClient } from './control-client.ts'
import type { SessionControlVerb } from './types.ts'

export { DEFAULT_PENDING_OP_AWAIT_MS }

/** Sink for non-fatal bridge diagnostics. */
export interface BridgeWarnSink { (message: string, error?: unknown): void }

/** Constructor options; mirrors the pre-split bridge exactly. */
export interface LifecycleBridgeOptions {
  client: SessionControlClient
  pendingOpAwaitMs: number
  warn?: BridgeWarnSink
}

/**
 * Raised when a session cannot safely start another request because a cache
 * mutation is pending or its outcome is unknown.
 *
 * Extends the host error so callers can keep catching `LlmError`, but carries a
 * distinct code so no host-level retry policy treats it as a transport blip.
 */
export class ControlBarrierError extends LlmError {
  constructor() {
    super(CONTROL_BARRIER_MESSAGE, 'CONTROL_BARRIER')
    this.name = 'ControlBarrierError'
  }
}

/** Re-throw core barrier failures as the host-visible error type. */
async function hostBarrier<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (isAgentHintError(error) && error.code === 'CONTROL_BARRIER') throw new ControlBarrierError()
    throw error
  }
}

export class LifecycleBridge {
  private readonly core: HintCoordinator
  /** Scope-local: which session the user last used in this host instance. */
  private lastOrdinarySessionId: string | undefined
  private disposed = false

  constructor(private readonly options: LifecycleBridgeOptions) {
    this.core = new HintCoordinator({
      transport: {
        send: command => options.client.send(
          command.verb, command.sessionId, command.model, command.signal, command.canSend,
        ),
      },
      pendingOpAwaitMs: options.pendingOpAwaitMs,
      ...options.warn === undefined ? {} : { warn: options.warn },
    })
  }

  /** Aborted when the bridge is disposed. */
  get signal(): AbortSignal { return this.core.signal }

  /** Wire DSH lifecycle events into the coordinator. */
  subscribe(ctx: Context): void {
    ctx.effect(() => () => this.dispose(), 'agent-hint: bridge state')
    ctx.on('session/created', session => this.onSessionCreated(session), { global: true })
    ctx.on('session/event', (session, event) => this.onSessionEvent(session, event), { global: true })
    ctx.on('session/disposed', session => this.onSessionDisposed(session), { global: true })
    ctx.on('workspace/session-archived', id => this.onSessionArchived(id), { global: true })
    ctx.on('agent/status', ({ agent, status }) => this.onAgentStatus(agent.id, status), { global: true })
    ctx.on('session/composing', id => this.onSessionComposing(id), { global: true })
  }

  dispose(): void {
    this.disposed = true
    this.lastOrdinarySessionId = undefined
    this.core.dispose()
  }

  /** Lifecycle facts the data plane needs to build a hint. */
  facts(sessionId: SessionId | undefined): {
    seeded: boolean; firstOrdinarySent: boolean; parentSessionId: SessionId | undefined
  } {
    const view = this.core.facts(sessionId === undefined ? undefined : String(sessionId))
    return {
      seeded: view.seeded,
      firstOrdinarySent: view.firstOrdinarySent,
      parentSessionId: view.parentSessionId === undefined ? undefined : toSessionId(view.parentSessionId),
    }
  }

  /** Prefetch is advisory. Pending/unknown mutations must not race new inference. */
  async awaitPendingOp(sessionId: SessionId | undefined, signal?: AbortSignal): Promise<void> {
    await hostBarrier(() => this.core.awaitPendingOp(
      sessionId === undefined ? undefined : String(sessionId), signal,
    ))
  }

  /** Hold mutations until the actual model stream finishes, errors or is cancelled. */
  async beginOrdinary(sessionId: SessionId | undefined, model: string, signal?: AbortSignal): Promise<() => void> {
    return hostBarrier(() => this.core.beginOrdinary(
      sessionId === undefined ? undefined : String(sessionId), model, signal,
    ))
  }

  /** Commit `start` bookkeeping for an accepted ordinary request. */
  noteOrdinaryRequest(sessionId: SessionId | undefined, model: string): void {
    if (sessionId === undefined || this.disposed) return
    const id = String(sessionId)
    // Foreground moved on: ask the coordinator to pause the session we left.
    // No model is passed — the paused session keeps its own last model.
    if (this.lastOrdinarySessionId !== undefined && this.lastOrdinarySessionId !== id) {
      this.core.requestPause(this.lastOrdinarySessionId)
    }
    this.lastOrdinarySessionId = id
    this.core.noteOrdinaryRequest(id, model)
  }

  onSessionCreated(session: Session): void {
    if (this.disposed) return
    this.core.registerSession({
      sessionId: String(session.id),
      seeded: session.surface.nodes.length > 0,
      ...session.header.parentSession === undefined
        ? {}
        : { parentSessionId: String(session.header.parentSession) },
    })
  }

  ensureResume(sessionId: SessionId | undefined, model: string): void {
    if (sessionId === undefined || this.disposed) return
    this.core.ensureResume(String(sessionId), model)
  }

  onAgentStatus(sessionId: SessionId, status: AgentStatus): void {
    if (this.disposed) return
    this.core.setAgentIdle(String(sessionId), status === 'idle')
  }

  onSessionComposing(sessionId: SessionId): void {
    const id = String(sessionId)
    const model = this.core.lastModelOf(id)
    if (model !== undefined && !this.core.isArchived(id)) this.core.ensureResume(id, model)
  }

  onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'compaction/end' || event.data.error !== undefined) return
    const id = String(session.id)
    const model = this.core.lastModelOf(id)
    if (model !== undefined) void this.core.requestControl({ verb: 'compact', sessionId: id, model })
  }

  onSessionDisposed(session: Session): void {
    const id = String(session.id)
    if (this.lastOrdinarySessionId === id) this.lastOrdinarySessionId = undefined
    this.core.releaseSession(id)
  }

  onSessionArchived(sessionId: SessionId): void {
    const id = String(sessionId)
    if (this.lastOrdinarySessionId === id) this.lastOrdinarySessionId = undefined
    this.core.archiveSession(id)
  }

  onSessionUnarchived(sessionId: SessionId): void {
    this.core.setArchived(String(sessionId), false)
  }
}

/** Re-exported for callers that previously imported it from this module. */
export type { ControlResult, SessionControlVerb }
