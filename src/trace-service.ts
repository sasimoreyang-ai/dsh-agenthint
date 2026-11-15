/** Read-only trace export through the stock authenticated Typert Gateway. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { HintTrace } from './trace.ts'
import type { HintTraceSnapshot } from './trace-record.ts'
import { readSessionTraceRecords } from './session-trace.ts'

/** Dependency carrier: one Cordis plugin argument, so both sides stay injectable. */
export interface AgentHintTraceServiceOptions {
  /** The plugin's bounded process window. */
  trace: HintTrace
  /** Live Session lookup for the records that live in the Session log. */
  resolveSession?: ((sessionId: string) => Session | undefined) | undefined
}

export class AgentHintTraceService extends TypertRemoteService {
  constructor(ctx: Context, private readonly options: AgentHintTraceServiceOptions) { super(ctx, 'agentHintTrace') }

  @Remote
  available(): boolean { return true }

  /**
   * Merge the in-process window with this plugin's records in the Session log.
   * @param request - exactly one `sessionId` of 1 to 512 characters.
   * @returns the merged, deduplicated snapshot naming both sources.
   */
  @Remote
  snapshot(request: unknown): HintTraceSnapshot {
    if (typeof request !== 'object' || request === null || Array.isArray(request)
      || Object.keys(request).length !== 1 || !('sessionId' in request)
      || typeof request.sessionId !== 'string' || request.sessionId.length === 0 || request.sessionId.length > 512) {
      throw new Error('Expected one sessionId of 1 to 512 characters')
    }
    const sessionId: string = request.sessionId
    return this.options.trace.snapshot(sessionId, this.readSessionLog(sessionId))
  }

  /**
   * Read this plugin's records back out of the Session log.
   * A missing Session (old host, or a session this process does not own) and a
   * refused read both degrade to "window only"; neither fails the download.
   * @param sessionId - the session the export is for.
   * @returns the read result, or `undefined` when no log is reachable.
   */
  private readSessionLog(sessionId: string) {
    const session = this.options.resolveSession?.(sessionId)
    if (session === undefined) return undefined
    return readSessionTraceRecords(session, sessionId, message => this.ctx.logger.warn(message))
  }
}
