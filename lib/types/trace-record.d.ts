/** Content-free diagnostic records shared by Host and Web. */
export interface HintTraceRecord {
    schemaVersion: 1;
    requestId: string;
    time: string;
    sessionId: string;
    plane: 'data' | 'control';
    transport: 'chat' | 'messages';
    model: string;
    attempt: number;
    phase: 'prepared' | 'dispatch' | 'result';
    outcome: 'prepared' | 'dispatching' | 'accepted' | 'rejected' | 'unknown' | 'cancelled' | 'not-dispatched';
    /** HTTP acceptance is never proof of KV completion or successful generation. */
    httpStatus?: number;
    durationMs?: number;
    dispatched?: boolean;
    hint: {
        session_id: string;
        parent_session_id?: string;
        session_control?: {
            type: string;
        };
        cache_control?: {
            type: string;
        };
    };
}
/**
 * Where an exported record came from, and how the merged list was deduplicated.
 * The two sources overlap: a record the Host just wrote to the Session log is
 * still inside its in-process window.
 */
export interface HintTraceSnapshotSources {
    /** Bounded in-process window owned by the adapter; cleared by restart or reload. */
    processWindow: {
        retention: 'process-local';
        records: number;
    };
    /** Durable `plugin:` records read back out of the Session log for this session. */
    sessionLog: {
        retention: 'session-log';
        recordType: string;
        /** `false` when no live Session was available, so nothing could be read back. */
        read: boolean;
        records: number;
        /** Records of this type whose `data` failed validation; skipped, never exported. */
        invalidRecords: number;
    };
    /** Two sources can hold the same attempt; an identical key is one record. */
    dedupe: 'requestId+phase+attempt+time';
}
export interface HintTraceSnapshot {
    /** 2 added `sources`; 1 carried a process-local window only. */
    schemaVersion: 2;
    sessionId: string;
    exportedAt: string;
    /** Bound of the in-process window that contributed {@link droppedRecords}. */
    limit: number;
    droppedRecords: number;
    sources: HintTraceSnapshotSources;
    /** Merged, deduplicated and time-ordered; never a claim of complete history. */
    records: HintTraceRecord[];
}
