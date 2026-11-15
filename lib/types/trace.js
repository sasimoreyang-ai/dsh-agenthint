/** Bounded, non-authoritative adapter diagnostics; no prompts, credentials or raw errors. */
import { randomUUID } from 'node:crypto';
import { HINT_TRACE_RECORD_TYPE } from "./session-trace.js";
const text = (value) => value.slice(0, 512);
/** Two sources hold the same attempt when all four fields match. */
const dedupeKey = (record) => `${record.requestId}\u0000${record.phase}\u0000${record.attempt}\u0000${record.time}`;
export class HintTrace {
    options;
    records = [];
    dropped = 0;
    constructor(options = {}) {
        this.options = options;
        const limit = options.maxRecords ?? 2000;
        if (!Number.isInteger(limit) || limit < 1 || limit > 10_000)
            throw new Error('Trace maxRecords must be an integer from 1 to 10000');
    }
    begin(facts, phase = 'dispatch') {
        if (this.options.enabled === false)
            return { dispatch() { }, finish() { } };
        const hint = { session_id: text(facts.hint.session_id) };
        if (facts.hint.parent_session_id !== undefined)
            hint.parent_session_id = text(facts.hint.parent_session_id);
        if (facts.hint.session_control !== undefined)
            hint.session_control = { type: facts.hint.session_control.type };
        if (facts.hint.cache_control !== undefined)
            hint.cache_control = { type: text(facts.hint.cache_control.type) };
        const base = { schemaVersion: 1, requestId: facts.requestId ?? randomUUID(), sessionId: text(facts.hint.session_id),
            plane: facts.plane, transport: facts.transport, model: text(facts.model), attempt: facts.attempt ?? 1, hint };
        let start = performance.now();
        this.emit({ ...base, time: new Date().toISOString(), phase,
            outcome: phase === 'prepared' ? 'prepared' : 'dispatching' });
        let finished = false;
        let dispatched = phase === 'dispatch';
        return { requestId: base.requestId, dispatch: () => {
                if (finished || dispatched)
                    return;
                dispatched = true;
                start = performance.now();
                this.emit({ ...base, time: new Date().toISOString(), phase: 'dispatch', outcome: 'dispatching' });
            }, finish: (outcome, details = {}) => {
                if (finished)
                    return;
                finished = true;
                this.emit({ ...base, time: new Date().toISOString(), phase: 'result', outcome,
                    durationMs: Math.max(0, Math.round((performance.now() - start) * 1000) / 1000),
                    ...details.httpStatus === undefined ? {} : { httpStatus: details.httpStatus },
                    ...details.dispatched === undefined ? {} : { dispatched: details.dispatched } });
            } };
    }
    /**
     * Merge the process-local window with the records read back from the Session
     * log. The window wins on a duplicate key because both copies are the same
     * object the writer emitted.
     * @param sessionId - the session the export is for.
     * @param fromLog - the Session log read-back, or `undefined` when nothing could be read.
     * @returns a detached snapshot naming both sources and the dedupe rule.
     */
    snapshot(sessionId, fromLog) {
        const window = this.records.filter(record => record.sessionId === sessionId);
        const merged = new Map();
        for (const record of window)
            merged.set(dedupeKey(record), record);
        for (const record of fromLog?.records ?? []) {
            const key = dedupeKey(record);
            if (!merged.has(key))
                merged.set(key, record);
        }
        // Stable time order only: for identical timestamps the merge order wins
        // (window records in emission order, then log-only records in log order), so
        // an attempt's phases stay contiguous and never reorder by request id.
        const records = [...merged.values()]
            .sort((left, right) => left.time < right.time ? -1 : left.time > right.time ? 1 : 0);
        return { schemaVersion: 2, sessionId, exportedAt: new Date().toISOString(),
            limit: this.limit, droppedRecords: this.dropped,
            sources: {
                processWindow: { retention: 'process-local', records: window.length },
                sessionLog: { retention: 'session-log', recordType: HINT_TRACE_RECORD_TYPE,
                    read: fromLog?.read ?? false, records: fromLog?.records.length ?? 0,
                    invalidRecords: fromLog?.invalid ?? 0 },
                dedupe: 'requestId+phase+attempt+time',
            },
            records: structuredClone(records) };
    }
    get limit() { return Math.max(1, Math.min(10_000, this.options.maxRecords ?? 2000)); }
    emit(record) {
        this.records.push(record);
        while (this.records.length > this.limit) {
            this.records.shift();
            this.dropped++;
        }
        // Logging must not fail or mutate requests, lifecycle state, or retained records.
        try {
            this.options.log?.(structuredClone(record));
        }
        catch { /* diagnostic sink only */ }
        // The Session log is a second diagnostic sink: a rejected append, a missing
        // store or an exhausted budget degrades to stdout and never reaches the callers.
        if (record.phase !== 'result')
            return;
        try {
            this.options.writeSessionRecord?.(structuredClone(record));
        }
        catch { /* diagnostic sink only */ }
    }
}
