/** Content-free diagnostic records written to stdout and the DSH Session log. */
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
