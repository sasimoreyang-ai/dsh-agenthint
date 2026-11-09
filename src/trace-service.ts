/** Read-only trace export through the stock authenticated Typert Gateway. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { HintTrace } from './trace.ts'
import type { HintTraceSnapshot } from './trace-record.ts'

export class AgentHintTraceService extends TypertRemoteService {
  constructor(ctx: Context, private readonly trace: HintTrace) { super(ctx, 'agentHintTrace') }

  @Remote
  available(): boolean { return true }

  @Remote
  snapshot(request: unknown): HintTraceSnapshot {
    if (typeof request !== 'object' || request === null || Array.isArray(request)
      || Object.keys(request).length !== 1 || !('sessionId' in request)
      || typeof request.sessionId !== 'string' || request.sessionId.length === 0 || request.sessionId.length > 512) {
      throw new Error('Expected one sessionId of 1 to 512 characters')
    }
    return this.trace.snapshot(request.sessionId)
  }
}
