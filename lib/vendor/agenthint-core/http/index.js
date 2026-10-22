/**
 * HTTP implementation of the control transport for the coordinator protocol.
 *
 * This sub-entry is optional: the coordinator itself only needs a
 * {@link ControlTransport}. Import this module when your backend speaks the
 * current coordinator protocol — an empty-messages chat-completions request
 * carrying `agent_hint.session_control`.
 *
 * Credentials, the endpoint and any attribution headers are resolved **once
 * per command** into an immutable snapshot, so a configuration change midway
 * through a request cannot send a control command to a different origin than
 * the one the caller authorised.
 *
 * @module agenthint-core/http
 */
/** Default per-attempt control timeout. */
export const DEFAULT_CONTROL_TIMEOUT_MS = 5_000;
/** Default extra attempts for advisory prefetch. */
export const DEFAULT_CONTROL_RETRIES = 1;
async function abortable(promise, signal) {
    signal.throwIfAborted();
    let abort;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
                abort = () => reject(signal.reason);
                signal.addEventListener('abort', abort, { once: true });
            })]);
    }
    finally {
        if (abort !== undefined)
            signal.removeEventListener('abort', abort);
    }
}
async function sleep(ms, signal) {
    if (signal?.aborted)
        return;
    await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, ms);
        signal?.addEventListener('abort', finish, { once: true });
    });
}
/**
 * Sends control verbs to a coordinator over HTTP.
 *
 * Retry policy is deliberately asymmetric. A mutating verb (`pause`, `stop`,
 * `compact`) that timed out or returned 5xx may already have executed, so it is
 * reported as `unknown` and never resent; the coordinator quarantines the
 * session until an operator resolves it. `resume` only prefetches, so an
 * explicit transient rejection is retried a bounded number of times.
 */
export class HttpControlTransport {
    options;
    timeoutMs;
    retries;
    fetchImpl;
    constructor(options) {
        this.options = options;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
        this.retries = options.retries ?? DEFAULT_CONTROL_RETRIES;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    }
    async send(command) {
        const { verb, sessionId, signal } = command;
        const cancelled = () => ({ status: 'cancelled', dispatched: false });
        if (signal?.aborted || !command.canSend())
            return cancelled();
        if (verb === 'start') {
            this.options.warn?.('agenthint-core: start must ride an ordinary request');
            return { status: 'failed', retryable: false };
        }
        let connection;
        try {
            const timeout = AbortSignal.timeout(this.timeoutMs);
            // Compose the fallback lazily: awaiting the credential here would bypass
            // the timeout that `abortable` is about to race against.
            const endpoint = this.options.endpoint ?? '';
            const authHeader = this.options.authHeader;
            const resolving = this.options.resolveConnection !== undefined
                ? this.options.resolveConnection()
                : this.options.resolveApiKey === undefined
                    ? Promise.resolve({ endpoint, authHeader })
                    : this.options.resolveApiKey().then(apiKey => ({ endpoint, apiKey, authHeader }));
            connection = await abortable(resolving, signal === undefined ? timeout : AbortSignal.any([signal, timeout]));
        }
        catch (error) {
            if (signal?.aborted)
                return cancelled();
            this.options.warn?.('agenthint-core: control connection resolution failed', error);
            return { status: 'failed', retryable: false };
        }
        if (signal?.aborted || !command.canSend())
            return cancelled();
        const body = JSON.stringify({
            model: command.model === '' ? this.options.defaultModel : command.model,
            messages: [],
            stream: false,
            agent_hint: { session_id: sessionId, session_control: { type: verb } },
        });
        for (let attempt = 0;; attempt++) {
            if (signal?.aborted || !command.canSend())
                return cancelled();
            const result = await this.attempt(body, verb, connection, signal);
            if (result.status !== 'accepted') {
                this.options.warn?.(`agenthint-core: session_control ${verb} for ${sessionId}: ${result.status}`
                    + ('httpStatus' in result ? ` HTTP ${result.httpStatus}` : ''));
            }
            // A 5xx/timeout on a mutating request cannot prove it did not execute.
            // Only prefetch retries explicit transient HTTP rejections.
            if (verb !== 'resume' || result.status !== 'failed' || !result.retryable
                || attempt >= this.retries)
                return result;
            await sleep(200, signal);
        }
    }
    async attempt(body, verb, connection, signal) {
        const timeout = AbortSignal.timeout(this.timeoutMs);
        try {
            const key = connection.apiKey;
            const header = connection.authHeader ?? this.options.authHeader ?? 'authorization';
            const headers = {
                'content-type': 'application/json',
                ...this.options.headers?.(),
                ...connection.headers,
            };
            if (key !== undefined)
                headers[header] = header === 'authorization' ? `Bearer ${key}` : key;
            const response = await this.fetchImpl(connection.endpoint, {
                method: 'POST',
                redirect: 'error',
                headers,
                body,
                signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                const transient = response.status === 408 || response.status === 429 || response.status >= 500;
                if (verb !== 'resume' && transient)
                    return { status: 'unknown' };
                return { status: 'failed', retryable: transient, httpStatus: response.status };
            }
            // Drain before returning; interrupted bodies retain an unknown outcome.
            await response.arrayBuffer();
            return { status: 'accepted', httpStatus: response.status };
        }
        catch {
            return signal?.aborted ? { status: 'cancelled', dispatched: true } : { status: 'unknown' };
        }
    }
}
