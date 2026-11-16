/** Bounded, non-authoritative adapter diagnostics; no prompts, credentials or raw errors. */
import { randomUUID } from 'node:crypto'
import type { AgentHintWire } from './types.ts'
import type { HintTraceRecord } from './trace-record.ts'
import { HINT_TRACE_RECORD_TYPE } from './session-trace.ts'

export interface HintTraceFacts {
  plane: HintTraceRecord['plane']
  transport: HintTraceRecord['transport']
  model: string
  hint: AgentHintWire
  attempt?: number
  requestId?: string
}
export interface HintTraceAttempt {
  readonly requestId?: string
  dispatch(): void
  finish(outcome: Extract<HintTraceRecord['outcome'], 'accepted' | 'rejected' | 'unknown' | 'cancelled' | 'not-dispatched'>,
    details?: { httpStatus?: number; dispatched?: boolean }): void
}
const text = (value: string) => value.slice(0, 512)
export class HintTrace {
  private readonly records: HintTraceRecord[] = []
  private dropped = 0
  constructor(private readonly options: {
    enabled?: boolean
    maxRecords?: number
    log?: (record: HintTraceRecord) => void
    /**
     * Durable mirror into the Session log. Called only for each attempt's
     * terminal `result` record, so the log gains one line per attempt. The sink
     * must not throw; `emit` contains it regardless.
     */
    writeSessionRecord?: (record: HintTraceRecord) => void
  } = {}) {
    const limit = options.maxRecords ?? 2000
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error('Trace maxRecords must be an integer from 1 to 10000')
  }

  /**
   * Records this process holds for one session, in emission order.
   *
   * The window keeps every attempt phase, unlike the Session log, which carries
   * only the terminal record; read it for in-process diagnosis and tests.
   * @param sessionId - session whose records to return.
   * @returns a detached copy; mutating it cannot alter retained records.
   */
  recordsOf(sessionId: string): HintTraceRecord[] {
    return structuredClone(this.records.filter(record => record.sessionId === sessionId))
  }
  begin(facts: HintTraceFacts, phase: 'prepared' | 'dispatch' = 'dispatch'): HintTraceAttempt {
    if (this.options.enabled === false) return { dispatch() {}, finish() {} }
    const hint: HintTraceRecord['hint'] = { session_id: text(facts.hint.session_id) }
    if (facts.hint.parent_session_id !== undefined) hint.parent_session_id = text(facts.hint.parent_session_id)
    if (facts.hint.session_control !== undefined) hint.session_control = { type: facts.hint.session_control.type }
    if (facts.hint.cache_control !== undefined) hint.cache_control = { type: text(facts.hint.cache_control.type) }
    const base = { schemaVersion: 1 as const, requestId: facts.requestId ?? randomUUID(), sessionId: text(facts.hint.session_id),
      plane: facts.plane, transport: facts.transport, model: text(facts.model), attempt: facts.attempt ?? 1, hint }
    let start = performance.now()
    this.emit({ ...base, time: new Date().toISOString(), phase,
      outcome: phase === 'prepared' ? 'prepared' : 'dispatching' })
    let finished = false
    let dispatched = phase === 'dispatch'
    return { requestId: base.requestId, dispatch: () => {
      if (finished || dispatched) return
      dispatched = true
      start = performance.now()
      this.emit({ ...base, time: new Date().toISOString(), phase: 'dispatch', outcome: 'dispatching' })
    }, finish: (outcome, details = {}) => {
      if (finished) return
      finished = true
      this.emit({ ...base, time: new Date().toISOString(), phase: 'result', outcome,
        durationMs: Math.max(0, Math.round((performance.now() - start) * 1000) / 1000),
        ...details.httpStatus === undefined ? {} : { httpStatus: details.httpStatus },
        ...details.dispatched === undefined ? {} : { dispatched: details.dispatched } })
    } }
  }


  private get limit(): number { return Math.max(1, Math.min(10_000, this.options.maxRecords ?? 2000)) }
  private emit(record: HintTraceRecord): void {
    this.records.push(record)
    while (this.records.length > this.limit) { this.records.shift(); this.dropped++ }
    // Logging must not fail or mutate requests, lifecycle state, or retained records.
    try { this.options.log?.(structuredClone(record)) } catch { /* diagnostic sink only */ }
    // The Session log is a second diagnostic sink: a rejected append, a missing
    // store or an exhausted budget degrades to stdout and never reaches the callers.
    if (record.phase !== 'result') return
    try { this.options.writeSessionRecord?.(structuredClone(record)) } catch { /* diagnostic sink only */ }
  }
}
