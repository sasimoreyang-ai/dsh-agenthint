/**
 * DSH-facing control client.
 *
 * The transport itself — snapshot semantics, retry asymmetry, body draining —
 * lives in `@sasimoreyang-ai/agenthint-core/http`. This module keeps the DSH
 * contract: the exported name, constructor shape and `send` signature, plus the
 * attribution headers DSH adds to every outbound request.
 *
 * HTTP acceptance is not KV completion.
 *
 * @module dsh-llm-agent-hint/control-client
 */
import { attributionHeaders } from '@deepseek-ai/dsh-llm';
import { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS, HttpControlTransport, } from '../vendor/agenthint-core/http/index.js';
export { DEFAULT_CONTROL_RETRIES, DEFAULT_CONTROL_TIMEOUT_MS };
/**
 * Sends control verbs to the coordinator on behalf of DSH.
 *
 * `start` is rejected here: it is a data-plane piggyback verb and must ride an
 * ordinary request, because a standalone empty-messages `start` has no effect
 * on the coordinator.
 */
export class SessionControlClient {
    transport;
    defaultModel;
    constructor(options) {
        this.defaultModel = options.model;
        const resolveConnection = options.resolveConnection;
        this.transport = new HttpControlTransport({
            ...resolveConnection === undefined ? {} : { resolveConnection },
            endpoint: options.endpoint,
            resolveApiKey: options.resolveApiKey,
            headers: () => attributionHeaders(),
            defaultModel: options.model,
            timeoutMs: options.timeoutMs,
            retries: options.retries,
            ...options.warn === undefined ? {} : { warn: options.warn },
        });
    }
    /** No automatic retry of mutating verbs or ambiguous network outcomes. */
    send(verb, sessionId, model, signal, canSend = () => true) {
        return this.transport.send({
            verb,
            sessionId,
            model: model ?? this.defaultModel,
            ...signal === undefined ? {} : { signal },
            canSend,
        });
    }
}
