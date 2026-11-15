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
import type { Session } from '@deepseek-ai/dsh-session';
import type { HintTraceRecord } from './trace-record.ts';
/**
 * The record name this package owns: `plugin:` plus the package-derived
 * segments (`mindagent-dsh-llm-agent-hint` / `trace`), so no other plugin can
 * collide with it. The grammar is lowercase slash-separated segments, which is
 * why the package/topic separator is `/` and not `:`.
 */
export declare const HINT_TRACE_RECORD_TYPE = "plugin:mindagent-dsh-llm-agent-hint/trace";
declare module '@deepseek-ai/dsh-session' {
    /**
     * Package-prefixed augmentation of the experimental plugin record catalog.
     * `appendPluginRecord` accepts exactly the keys of this map that widen to
     * {@link PluginRecordType}, so an unregistered name is a compile error rather
     * than a runtime throw.
     */
    interface PluginRecordMap {
        'plugin:mindagent-dsh-llm-agent-hint/trace': HintTraceRecord;
    }
}
/** Result of reading this package's records back out of one Session log. */
export interface SessionTraceReadResult {
    /** Valid records whose payload names the requested session, in log order. */
    records: HintTraceRecord[];
    /**
     * Our record type whose payload failed validation and was skipped. A broken
     * payload cannot be attributed to a session, so this counts every corrupted
     * record of this type found in the log, including ones a fork inherited.
     */
    invalid: number;
    /** Whether the log could be read at all (`false` when the Session refused a read). */
    read: boolean;
}
/**
 * Validate one restored `data` payload and rebuild it field by field.
 *
 * Restored records carry whatever JSON an earlier build wrote, so every field
 * is re-checked and copied: unknown keys are dropped instead of exported.
 * @param data - the `data` of one plugin record, of unknown provenance.
 * @returns the sanitized record, or `undefined` when the payload is unusable.
 */
export declare function hintTraceRecordOf(data: unknown): HintTraceRecord | undefined;
/** Dependencies of {@link createSessionTraceSink}. */
export interface HintTraceSessionSinkOptions {
    /** Resolve the live Session for one session id; omission or `undefined` skips the write. */
    resolveSession?: ((sessionId: string) => Session | undefined) | undefined;
    /**
     * Per-session append budget, reusing the trace window bound (`maxRecords`).
     * The process window is bounded in memory; the log is durable, so it gets the
     * same ceiling per session instead of growing without limit.
     */
    maxRecords?: number | undefined;
    /** Append primitive, injectable so a test can simulate a host that moved or lost it. */
    append?: typeof dshSession.appendPluginRecord | undefined;
    /** Warning sink; every failure here is diagnosis, never control flow. */
    warn?: ((message: string, error?: unknown) => void) | undefined;
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
export declare function createSessionTraceSink(options?: HintTraceSessionSinkOptions): (record: HintTraceRecord) => void;
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
export declare function readSessionTraceRecords(session: Session, sessionId: string, warn?: (message: string) => void): SessionTraceReadResult;
