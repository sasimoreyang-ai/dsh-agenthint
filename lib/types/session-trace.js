/**
 * The same bounded, content-free Hint trace, mirrored into the DSH Session log
 * through the 0.2.2 `appendPluginRecord` channel, plus the validated read-back
 * the download path uses.
 *
 * Why this is allowed now: DSH 0.2.2-rc.1 publishes an official experimental
 * channel for plugin-owned events. A plugin record is an event marked
 * `ignorable`; a reader that does not know the type retains and skips it, and
 * the record never enters the model-visible surface (no `surfaceOp`). Fork and
 * resume carry the records along with the rest of the log, which is exactly the
 * retention this diagnostic wants.
 *
 * Deliberate trade-off (reviewed and accepted): `appendPluginRecord` documents
 * that "only production source under `packages/experimental/` may call this
 * function". That rule is a repository policy gate on DSH's own sources, not a
 * runtime check — nothing here is rejected or degraded at runtime. This package
 * is intentionally outside that policy scope and uses the channel anyway, so an
 * upgrade must re-confirm three things: that the function still exists, that its
 * `PluginRecordMap` augmentation point is unchanged, and that an unrecognized
 * `ignorable` record is still retained and skipped rather than rejected.
 *
 * @module dsh-llm-agent-hint/session-trace
 */
import * as dshSession from '@deepseek-ai/dsh-session';
/**
 * The record name this package owns: `plugin:` plus the package-derived
 * segments (`mindagent-dsh-llm-agent-hint` / `trace`), so no other plugin can
 * collide with it. The grammar is lowercase slash-separated segments, which is
 * why the package/topic separator is `/` and not `:`.
 */
export const HINT_TRACE_RECORD_TYPE = 'plugin:mindagent-dsh-llm-agent-hint/trace';
const PHASES = ['prepared', 'dispatch', 'result'];
const OUTCOMES = ['prepared', 'dispatching', 'accepted', 'rejected', 'unknown', 'cancelled', 'not-dispatched'];
/** Same bound the writer applies, so a restored record cannot smuggle longer strings into an export. */
const MAX_TEXT = 512;
const DEFAULT_MAX_RECORDS = 2000;
/** Corrupted payloads warn at most this many times per read; the total is still reported. */
const MAX_WARNINGS = 5;
const isText = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;
const isCount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
/**
 * Validate one restored `data` payload and rebuild it field by field.
 *
 * Restored records carry whatever JSON an earlier build wrote, so every field
 * is re-checked and copied: unknown keys are dropped instead of exported.
 * @param data - the `data` of one plugin record, of unknown provenance.
 * @returns the sanitized record, or `undefined` when the payload is unusable.
 */
export function hintTraceRecordOf(data) {
    if (data === null || typeof data !== 'object' || Array.isArray(data))
        return undefined;
    const raw = data;
    if (raw.schemaVersion !== 1)
        return undefined;
    const { requestId, time, sessionId, model, attempt, phase, outcome } = raw;
    if (!isText(requestId) || !isText(time) || !isText(sessionId) || !isText(model))
        return undefined;
    if (Number.isNaN(Date.parse(time)))
        return undefined;
    if (!isCount(attempt) || attempt < 1)
        return undefined;
    if (typeof phase !== 'string' || !PHASES.includes(phase))
        return undefined;
    if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome))
        return undefined;
    if (raw.plane !== 'data' && raw.plane !== 'control')
        return undefined;
    if (raw.transport !== 'chat' && raw.transport !== 'messages')
        return undefined;
    const hint = hintOf(raw.hint);
    if (hint === undefined)
        return undefined;
    const record = { schemaVersion: 1, requestId, time, sessionId,
        plane: raw.plane, transport: raw.transport, model, attempt,
        phase: phase, outcome: outcome, hint };
    if (raw.httpStatus !== undefined) {
        if (!isCount(raw.httpStatus))
            return undefined;
        record.httpStatus = raw.httpStatus;
    }
    if (raw.durationMs !== undefined) {
        if (typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) || raw.durationMs < 0)
            return undefined;
        record.durationMs = raw.durationMs;
    }
    if (raw.dispatched !== undefined) {
        if (typeof raw.dispatched !== 'boolean')
            return undefined;
        record.dispatched = raw.dispatched;
    }
    return record;
}
function hintOf(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const raw = value;
    if (!isText(raw.session_id))
        return undefined;
    const hint = { session_id: raw.session_id };
    if (raw.parent_session_id !== undefined) {
        if (!isText(raw.parent_session_id))
            return undefined;
        hint.parent_session_id = raw.parent_session_id;
    }
    for (const key of ['session_control', 'cache_control']) {
        const block = raw[key];
        if (block === undefined)
            continue;
        if (block === null || typeof block !== 'object' || Array.isArray(block))
            return undefined;
        const type = block.type;
        if (!isText(type))
            return undefined;
        hint[key] = { type };
    }
    return hint;
}
/**
 * Build the session-log sink the trace calls on each attempt's terminal record.
 *
 * The returned function never throws: a missing store, a missing primitive, an
 * exhausted budget or a rejected append all degrade to "stdout only", because a
 * diagnostic write must never fail or delay inference.
 * @param options - session lookup, budget, append primitive and warning sink.
 * @returns a sink that appends at most one record per attempt terminal state.
 */
export function createSessionTraceSink(options = {}) {
    const limit = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    const written = new Map();
    const saturated = new Set();
    const failed = new Set();
    const warn = (message, error) => {
        try {
            options.warn?.(message, error);
        }
        catch { /* diagnostic sink only */ }
    };
    return record => {
        // Only the terminal record is durable: `prepared`/`dispatch` stay process-local
        // so the log grows by one line per attempt instead of three.
        if (record.phase !== 'result' || record.sessionId.length === 0)
            return;
        try {
            const append = 'append' in options ? options.append : dshSession.appendPluginRecord;
            if (typeof append !== 'function')
                return; // Host predates the plugin record channel.
            const count = written.get(record.sessionId) ?? 0;
            if (count >= limit) {
                if (!saturated.has(record.sessionId)) {
                    saturated.add(record.sessionId);
                    warn(`agent-hint: session trace budget of ${limit} records reached for session ${record.sessionId}; further records go to stdout only`);
                }
                return;
            }
            const session = options.resolveSession?.(record.sessionId);
            if (session === undefined)
                return; // No live Session (no store, or a session this process does not own).
            append(session, HINT_TRACE_RECORD_TYPE, record);
            written.set(record.sessionId, count + 1);
        }
        catch (error) {
            if (!failed.has(record.sessionId)) {
                failed.add(record.sessionId);
                warn(`agent-hint: cannot append a trace record to the session log of ${record.sessionId}; continuing with stdout only`, error);
            }
        }
    };
}
/**
 * Read this package's records back out of one Session log.
 *
 * Restored and forked logs can hold records written by an older build (or a
 * renamed ignorable V3 event), so each payload is validated by
 * {@link hintTraceRecordOf}; a bad one is counted and skipped, never thrown.
 * Records that name a different session are dropped: a fork inherits its
 * parent's records, and an export must describe the session it is named after.
 * @param session - the live Session whose log is read.
 * @param sessionId - the session id the export is for.
 * @param warn - optional warning sink; at most {@link MAX_WARNINGS} calls per read.
 * @returns valid records plus the count of skipped and unreadable sources.
 */
export function readSessionTraceRecords(session, sessionId, warn) {
    let events;
    try {
        events = session.snapshotEvents();
    }
    catch {
        return { records: [], invalid: 0, read: false };
    }
    const records = [];
    let invalid = 0;
    let reported = 0;
    for (const event of events) {
        let entry;
        try {
            entry = dshSession.pluginRecordOf(event);
        }
        catch {
            entry = undefined;
        }
        if (entry === undefined || entry.type !== HINT_TRACE_RECORD_TYPE)
            continue;
        const record = hintTraceRecordOf(entry.data);
        if (record === undefined) {
            invalid++;
            // One bad payload must not turn into unbounded warning traffic; the total
            // is reported through `invalid` either way.
            if (reported++ < MAX_WARNINGS) {
                try {
                    warn?.(`agent-hint: skipping unreadable session trace record at seq ${event.seq} of ${sessionId}`);
                }
                catch { /* sink only */ }
            }
        }
        else if (record.sessionId === sessionId)
            records.push(record);
    }
    return { records, invalid, read: true };
}
