/** Reuse the connection facts a sibling DeepSeek route already resolved.
 *
 * The plugin is installed into a harness that, to be useful at all, already
 * reaches some model. That route's endpoint and catalog are exactly what this
 * plugin needs, so reading them removes the only field an operator would
 * otherwise have to retype by hand.
 *
 * @module dsh-llm-agent-hint/inherited-connection
 */
/** Loader entry id whose endpoint and catalog stand in for missing operator configuration. */
export const INHERIT_SOURCE_ID = 'llm-deepseek';
/**
 * Read the sibling route's endpoint and catalog, if it configured any.
 *
 * Absent services, absent entries and malformed values all yield the empty
 * shape: inheritance is an optimisation, never a prerequisite, so no failure
 * here may surface as an error.
 *
 * @param ctx - plugin context that may expose the configuration editor.
 * @param sourceId - loader entry id to read facts from.
 * @returns detached endpoint facts; empty when nothing could be read.
 */
export function readInheritedConnection(ctx, sourceId = INHERIT_SOURCE_ID) {
    const editor = ctx.get('configEditor');
    if (editor === undefined)
        return {};
    let rows;
    try {
        rows = editor.configuration();
    }
    catch {
        return {};
    }
    for (const row of rows) {
        if (row.entry.options?.id !== sourceId)
            continue;
        const merged = { ...row.inherited, ...row.override };
        const baseURL = typeof merged.baseURL === 'string' && merged.baseURL.length > 0 ? merged.baseURL : undefined;
        const models = Array.isArray(merged.models) ? merged.models : undefined;
        return {
            ...baseURL === undefined ? {} : { baseURL },
            ...models === undefined ? {} : { models },
        };
    }
    return {};
}
