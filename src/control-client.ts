/** Bounded advisory control transport. HTTP acceptance is not KV completion. */
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { SessionControlVerb } from './types.ts'

export type ControlResult =
  | { status: 'accepted'; httpStatus: number }
  | { status: 'failed'; retryable: boolean; httpStatus?: number }
  | { status: 'unknown' }
  | { status: 'cancelled'; dispatched: boolean }

export interface ControlWarnSink { (message: string, error?: unknown): void }
export interface ControlConnection {
  endpoint: string
  apiKey: string | undefined
  authHeader?: 'authorization' | 'x-api-key'
}
export interface SessionControlClientOptions {
  resolveConnection?: () => Promise<ControlConnection>
  endpoint: string
  resolveApiKey: () => Promise<string | undefined>
  model: string
  timeoutMs: number
  retries: number
  warn?: ControlWarnSink
}
export const DEFAULT_CONTROL_TIMEOUT_MS = 5_000
export const DEFAULT_CONTROL_RETRIES = 1

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })])
  } finally { if (abort !== undefined) signal.removeEventListener('abort', abort) }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

export class SessionControlClient {
  constructor(private readonly options: SessionControlClientOptions) {}

  /** No automatic retry of mutating verbs or ambiguous network outcomes. */
  async send(verb: SessionControlVerb, sessionId: string, model?: string, signal?: AbortSignal,
    canSend: () => boolean = () => true): Promise<ControlResult> {
    const cancelled = (): ControlResult => ({ status: 'cancelled', dispatched: false })
    if (signal?.aborted || !canSend()) return cancelled()
    if (verb === 'start') {
      this.options.warn?.('llm-agent-hint: start must ride an ordinary request')
      return { status: 'failed', retryable: false }
    }
    let connection: ControlConnection
    try {
      const timeout = AbortSignal.timeout(this.options.timeoutMs)
      const resolving = this.options.resolveConnection === undefined
        ? this.options.resolveApiKey().then(apiKey => ({ endpoint: this.options.endpoint, apiKey }))
        : this.options.resolveConnection()
      connection = await abortable(resolving, signal === undefined ? timeout : AbortSignal.any([signal, timeout]))
    } catch (error) {
      if (signal?.aborted) return cancelled()
      this.options.warn?.('llm-agent-hint: control connection resolution failed', error)
      return { status: 'failed', retryable: false }
    }
    if (signal?.aborted || !canSend()) return cancelled()
    const body = JSON.stringify({ model: model ?? this.options.model, messages: [], stream: false,
      agent_hint: { session_id: sessionId, session_control: { type: verb } } })
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted || !canSend()) return cancelled()
      const result = await this.attempt(body, verb, connection, signal)
      if (result.status !== 'accepted') this.options.warn?.(
        `llm-agent-hint: session_control ${verb} for ${sessionId}: ${result.status}`
        + ('httpStatus' in result ? ` HTTP ${result.httpStatus}` : ''))
      // A 5xx/timeout on a mutating request cannot prove it did not execute.
      // Only prefetch retries explicit transient HTTP rejections.
      if (verb !== 'resume' || result.status !== 'failed' || !result.retryable
        || attempt >= this.options.retries) return result
      await sleep(200, signal)
    }
  }

  private async attempt(body: string, verb: SessionControlVerb,
    connection: ControlConnection, signal?: AbortSignal): Promise<ControlResult> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    try {
      const key = connection.apiKey
      const header = connection.authHeader ?? 'authorization'
      const response = await fetch(connection.endpoint, {
        method: 'POST', redirect: 'error',
        headers: { ...key === undefined ? {} : { [header]: header === 'authorization' ? `Bearer ${key}` : key },
          'content-type': 'application/json', ...attributionHeaders() },
        body, signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        const transient = response.status === 408 || response.status === 429 || response.status >= 500
        if (verb !== 'resume' && transient) return { status: 'unknown' }
        return { status: 'failed', retryable: transient, httpStatus: response.status }
      }
      // Drain before returning; interrupted bodies retain an unknown outcome.
      await response.arrayBuffer()
      return { status: 'accepted', httpStatus: response.status }
    } catch {
      return signal?.aborted ? { status: 'cancelled', dispatched: true } : { status: 'unknown' }
    }
  }
}
