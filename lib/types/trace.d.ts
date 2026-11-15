import type { AgentHintWire } from './types.ts';
import type { HintTraceRecord, HintTraceSnapshot } from './trace-record.ts';
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
    });
    begin(facts: HintTraceFacts, phase?: 'prepared' | 'dispatch'): HintTraceAttempt;
    snapshot(sessionId: string): HintTraceSnapshot;
    private get limit();
    private emit;
}
