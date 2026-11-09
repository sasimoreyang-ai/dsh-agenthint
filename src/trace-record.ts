/** Content-free diagnostic records shared by Host and Web. */
export interface HintTraceRecord {
  schemaVersion: 1
  requestId: string
  time: string
  sessionId: string
  plane: 'data' | 'control'
  transport: 'chat' | 'messages'
  model: string
  attempt: number
  phase: 'prepared' | 'dispatch' | 'result'
  outcome: 'prepared' | 'dispatching' | 'accepted' | 'rejected' | 'unknown' | 'cancelled' | 'not-dispatched'
  /** HTTP acceptance is never proof of KV completion or successful generation. */
  httpStatus?: number
  durationMs?: number
  dispatched?: boolean
  hint: {
    session_id: string
    parent_session_id?: string
    session_control?: { type: string }
    cache_control?: { type: string }
  }
}

export interface HintTraceSnapshot {
  schemaVersion: 1
  sessionId: string
  exportedAt: string
  /** This is a bounded, process-local window, not the durable Session ledger. */
  retention: 'process-local'
  limit: number
  droppedRecords: number
  records: HintTraceRecord[]
}
