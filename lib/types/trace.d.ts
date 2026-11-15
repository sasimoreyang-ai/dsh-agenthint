import type { AgentHintWire } from './types.ts';
import type { HintTraceRecord, HintTraceSnapshot } from './trace-record.ts';
import type { SessionTraceReadResult } from './session-trace.ts';
export interface HintTraceFacts {
    plane: HintTraceRecord['plane'];
    transport: HintTraceRecord['transport'];
    model: string;
    hint: AgentHintWire;
    attempt?: number;
    requestId?: string;
}
export interface HintTraceAttempt {
    readonly requestId?: string;
    dispatch(): void;
    finish(outcome: Extract<HintTraceRecord['outcome'], 'accepted' | 'rejected' | 'unknown' | 'cancelled' | 'not-dispatched'>, details?: {
        httpStatus?: number;
        dispatched?: boolean;
    }): void;
}
export declare class HintTrace {
    private readonly options;
    private readonly records;
    private dropped;
    constructor(options?: {
        enabled?: boolean;
        maxRecords?: number;
        log?: (record: HintTraceRecord) => void;
        /**
         * Durable mirror into the Session log. Called only for each attempt's
         * terminal `result` record, so the log gains one line per attempt. The sink
         * must not throw; `emit` contains it regardless.
         */
        writeSessionRecord?: (record: HintTraceRecord) => void;
    });
    begin(facts: HintTraceFacts, phase?: 'prepared' | 'dispatch'): HintTraceAttempt;
    /**
     * Merge the process-local window with the records read back from the Session
     * log. The window wins on a duplicate key because both copies are the same
     * object the writer emitted.
     * @param sessionId - the session the export is for.
     * @param fromLog - the Session log read-back, or `undefined` when nothing could be read.
     * @returns a detached snapshot naming both sources and the dedupe rule.
     */
    snapshot(sessionId: string, fromLog?: SessionTraceReadResult): HintTraceSnapshot;
    private get limit();
    private emit;
}
