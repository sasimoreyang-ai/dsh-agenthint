/** Read-only trace export through the stock authenticated Typert Gateway. */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { HintTrace } from './trace.ts';
import type { HintTraceSnapshot } from './trace-record.ts';
export declare class AgentHintTraceService extends TypertRemoteService {
    private readonly trace;
    constructor(ctx: Context, trace: HintTrace);
    available(): boolean;
    snapshot(request: unknown): HintTraceSnapshot;
}
