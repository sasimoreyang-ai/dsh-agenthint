/** Read-only trace export through the stock authenticated Typert Gateway. */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { HintTrace } from './trace.ts';
import type { HintTraceSnapshot } from './trace-record.ts';
/** Dependency carrier: one Cordis plugin argument, so both sides stay injectable. */
export interface AgentHintTraceServiceOptions {
    /** The plugin's bounded process window. */
    trace: HintTrace;
    /** Live Session lookup for the records that live in the Session log. */
    resolveSession?: ((sessionId: string) => Session | undefined) | undefined;
}
export declare class AgentHintTraceService extends TypertRemoteService {
    private readonly options;
    constructor(ctx: Context, options: AgentHintTraceServiceOptions);
    available(): boolean;
    /**
     * Merge the in-process window with this plugin's records in the Session log.
     * @param request - exactly one `sessionId` of 1 to 512 characters.
     * @returns the merged, deduplicated snapshot naming both sources.
     */
    snapshot(request: unknown): HintTraceSnapshot;
    /**
     * Read this plugin's records back out of the Session log.
     * A missing Session (old host, or a session this process does not own) and a
     * refused read both degrade to "window only"; neither fails the download.
     * @param sessionId - the session the export is for.
     * @returns the read result, or `undefined` when no log is reachable.
     */
    private readSessionLog;
}
