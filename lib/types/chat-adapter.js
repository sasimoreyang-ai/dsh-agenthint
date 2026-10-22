/** OpenAI chat/completions transport for the agent-hint route.
 *
 * The Messages transport loses `agent_hint` on engines whose Anthropic
 * entrypoint does not declare the field: the request model drops unknown keys
 * before the session-aware manager sees them, so lifecycle control silently
 * no-ops. The chat/completions entrypoint declares the field on those same
 * engines, so speaking that protocol keeps the hint intact without touching the
 * engine.
 *
 * @module dsh-llm-agent-hint/chat-adapter
 */
import { attributionHeaders, LlmAdapter, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm';
import { catalogModelInfo } from '@deepseek-ai/dsh-llm-deepseek';
/** Compose a failure message from a non-2xx response. */
function describeFailure(status, body) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        // Non-JSON gateway bodies are reported verbatim by the caller.
    }
    const message = typeof parsed?.error?.message === 'string'
        ? parsed.error.message
        : typeof parsed?.detail === 'string' ? parsed.detail : undefined;
    return message === undefined
        ? `chat/completions request failed with HTTP ${status}`
        : `chat/completions request failed with HTTP ${status}: ${message}`;
}
/** Concatenate the text blocks of one content list.
 *
 * Reasoning, image, file and tool-declaration blocks have no chat/completions
 * equivalent on the coordinator, so they are dropped rather than rejected: a
 * session that accumulated them must still be replayable.
 */
function textOf(blocks) {
    const parts = [];
    for (const block of blocks) {
        if (block.type === 'text')
            parts.push(block.text);
    }
    return parts.join('\n');
}
/** Collect the assistant tool calls carried by one content list. */
function toolCallsOf(blocks) {
    const calls = [];
    for (const block of blocks) {
        if (block.type !== 'tool-call')
            continue;
        calls.push({
            id: String(block.id),
            type: 'function',
            function: { name: block.name, arguments: block.arguments },
        });
    }
    return calls;
}
/** Map one harness message onto the chat/completions shape. */
function toChatMessage(message) {
    const content = message.content;
    if (typeof content === 'string') {
        return { role: message.role === 'assistant' ? 'assistant' : 'user', content };
    }
    const blocks = content;
    const text = textOf(blocks);
    if (message.role === 'assistant') {
        const calls = toolCallsOf(blocks);
        return {
            role: 'assistant',
            ...text.length === 0 ? {} : { content: text },
            ...calls.length === 0 ? {} : { tool_calls: calls },
        };
    }
    return { role: 'user', content: text };
}
/** Build the request body for one call. */
function buildBody(options, defaults, hint) {
    const messages = [];
    if (options.system !== undefined && options.system.length > 0) {
        messages.push({ role: 'system', content: options.system });
    }
    for (const message of options.messages)
        messages.push(toChatMessage(message));
    const body = {
        model: options.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
    };
    const maxTokens = options.maxTokens ?? defaults.maxTokens;
    if (maxTokens !== undefined)
        body.max_tokens = maxTokens;
    if (options.temperature !== undefined)
        body.temperature = options.temperature;
    if (options.stop !== undefined && options.stop.length > 0)
        body.stop = options.stop;
    if (options.tools !== undefined && options.tools.length > 0) {
        body.tools = options.tools.map(tool => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
    }
    if (hint !== undefined)
        body.agent_hint = hint;
    return body;
}
/** Map a provider finish reason onto the harness vocabulary. */
function finishOf(raw) {
    switch (raw) {
        case 'tool_calls':
        case 'function_call':
            return { kind: 'tool-calls' };
        case 'length':
            return { kind: 'max-tokens' };
        default:
            return { kind: 'stop' };
    }
}
/** Decode an SSE byte stream into `data:` payloads. */
async function* sseEvents(response) {
    if (response.body === null)
        throw new LlmError('chat/completions returned no body', 'TRANSPORT');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            while (true) {
                const cut = buffer.indexOf('\n\n');
                if (cut < 0)
                    break;
                const frame = buffer.slice(0, cut);
                buffer = buffer.slice(cut + 2);
                for (const line of frame.split('\n')) {
                    if (!line.startsWith('data:'))
                        continue;
                    const payload = line.slice(5).trim();
                    if (payload.length === 0 || payload === '[DONE]')
                        continue;
                    try {
                        yield JSON.parse(payload);
                    }
                    catch {
                        // A malformed frame is skipped; the stream stays usable.
                    }
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
/** Translate provider events into the harness stream protocol. */
async function* translate(events) {
    let textIndex;
    let reasoningIndex;
    const calls = new Map();
    let nextIndex = 0;
    let reason;
    let usage;
    for await (const event of events) {
        if (event.usage !== undefined) {
            const prompt = typeof event.usage.prompt_tokens === 'number' ? event.usage.prompt_tokens : 0;
            const cached = typeof event.usage.prompt_tokens_details?.cached_tokens === 'number'
                ? event.usage.prompt_tokens_details.cached_tokens
                : 0;
            const output = typeof event.usage.completion_tokens === 'number' ? event.usage.completion_tokens : 0;
            usage = {
                inputTokens: Math.max(0, prompt - cached),
                outputTokens: output,
                ...cached === 0 ? {} : { cacheReadTokens: cached },
                ...typeof event.usage.total_tokens === 'number' ? { totalTokens: event.usage.total_tokens } : {},
                ...typeof event.usage.completion_tokens_details?.reasoning_tokens === 'number'
                    ? { reasoningTokens: event.usage.completion_tokens_details.reasoning_tokens }
                    : {},
            };
        }
        for (const choice of event.choices ?? []) {
            const delta = choice.delta;
            if (delta !== undefined) {
                if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
                    if (reasoningIndex === undefined) {
                        reasoningIndex = nextIndex++;
                        yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' };
                    }
                    yield { type: 'reasoning-delta', index: reasoningIndex, text: delta.reasoning_content };
                }
                if (typeof delta.content === 'string' && delta.content.length > 0) {
                    if (textIndex === undefined) {
                        textIndex = nextIndex++;
                        yield { type: 'block-start', index: textIndex, blockType: 'text' };
                    }
                    yield { type: 'text-delta', index: textIndex, text: delta.content };
                }
                if (Array.isArray(delta.tool_calls)) {
                    for (const raw of delta.tool_calls) {
                        const call = raw;
                        const wireIndex = typeof call.index === 'number' ? call.index : 0;
                        let state = calls.get(wireIndex);
                        if (state === undefined) {
                            state = {
                                index: nextIndex++,
                                id: ToolCallId(typeof call.id === 'string' && call.id.length > 0 ? call.id : `call_${wireIndex}`),
                                name: typeof call.function?.name === 'string' ? call.function.name : '',
                            };
                            calls.set(wireIndex, state);
                            yield { type: 'block-start', index: state.index, blockType: 'tool-call' };
                            yield { type: 'tool-call-delta', index: state.index, id: state.id, name: state.name, argumentsDelta: '' };
                        }
                        const args = call.function?.arguments;
                        if (typeof args === 'string' && args.length > 0) {
                            yield { type: 'tool-call-delta', index: state.index, id: state.id, argumentsDelta: args };
                        }
                    }
                }
            }
            if (choice.finish_reason != null)
                reason = finishOf(choice.finish_reason);
        }
    }
    if (reason === undefined)
        reason = { kind: 'stop' };
    if (reason.kind === 'stop' && textIndex === undefined && calls.size === 0) {
        throw new LlmError('chat/completions returned no content', 'EMPTY_RESPONSE');
    }
    if (usage !== undefined)
        yield { type: 'usage', usage };
    yield { type: 'finish', reason };
}
/** Adapter speaking the coordinator's OpenAI chat/completions entrypoint. */
export class ChatCompletionsAdapter extends LlmAdapter {
    #dependencies;
    constructor(dependencies) {
        super();
        this.#dependencies = dependencies;
    }
    providerInfo(provider) {
        return { id: provider, name: this.#dependencies.providerName ?? 'DeepSeek (agent-hint)' };
    }
    async listModels(provider) {
        return await this.#dependencies.discoverModels?.(provider) ?? [];
    }
    resolveModel(provider, model) {
        return Promise.resolve(this.#modelInfo(provider, model));
    }
    prepareCall(provider, model) {
        const connection = this.#dependencies.options();
        return Promise.resolve({
            model: this.#modelInfo(provider, model),
            stream: options => this.#generate(options, connection),
        });
    }
    stream(options) {
        return this.#generate(options, this.#dependencies.options());
    }
    #modelInfo(provider, model) {
        const connection = this.#dependencies.options();
        const catalog = {
            id: model,
            ...connection.maxTokens === undefined ? {} : { maxTokens: connection.maxTokens },
        };
        return catalogModelInfo(provider, catalog);
    }
    async *#generate(options, connection) {
        options.signal?.throwIfAborted();
        const request = {
            sessionId: options.sessionId === undefined ? undefined : String(options.sessionId),
            purpose: options.purpose,
        };
        const hint = await this.#dependencies.prepareHint?.(request);
        const body = buildBody(options, connection, hint);
        const auth = await this.#dependencies.resolveAuth();
        // The coordinator mounts OpenAI routes under `/v1`; a baseURL that already
        // names that root must not grow a second one.
        const root = connection.baseURL.replace(/\/+$/, '');
        const url = `${root.endsWith('/v1') ? root : `${root}/v1`}/chat/completions`;
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                ...options.signal === undefined ? {} : { signal: options.signal },
                body: JSON.stringify(body),
                redirect: 'error',
                headers: {
                    ...attributionHeaders(),
                    'content-type': 'application/json',
                    accept: 'text/event-stream',
                    ...auth.headers,
                },
            });
        }
        catch (error) {
            if (options.signal?.aborted)
                throw new LlmError('chat/completions request aborted', 'ABORTED', { cause: error });
            throw new LlmError('chat/completions transport failed', 'TRANSPORT', { cause: error });
        }
        if (!response.ok) {
            throw new LlmError(describeFailure(response.status, await response.text()), 'INVALID_RESPONSE');
        }
        this.#dependencies.onAccepted?.(request);
        try {
            yield* translate(sseEvents(response));
        }
        catch (error) {
            if (error instanceof LlmError)
                throw error;
            if (options.signal?.aborted)
                throw new LlmError('chat/completions request aborted', 'ABORTED', { cause: error });
            throw new LlmError('chat/completions transport failed', 'TRANSPORT', { cause: error });
        }
    }
}
