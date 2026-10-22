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

import { attributionHeaders, LlmAdapter, LlmError, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmModelReasoningInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { catalogModelInfo } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekCatalogModel } from '@deepseek-ai/dsh-llm-deepseek'
import type { AgentHintWire } from './types.ts'

/** One assistant tool call in the OpenAI shape. */
interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** One message in the OpenAI chat shape. */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content?: string
  tool_calls?: ChatToolCall[]
}

/** One tool declaration in the OpenAI shape. */
interface ChatTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/** Reasoning efforts this route offers, mirroring the coordinator's vocabulary. */
const EFFORT_OFF = ReasoningEffortId('off')
const EFFORT_LOW = ReasoningEffortId('low')
const EFFORT_HIGH = ReasoningEffortId('high')
const EFFORT_MAX = ReasoningEffortId('max')

/** Wire value for each effort; the coordinator spells "off" as "none". */
const EFFORT_WIRE: ReadonlyMap<string, string> = new Map([
  [String(EFFORT_OFF), 'none'],
  [String(EFFORT_LOW), 'low'],
  [String(EFFORT_HIGH), 'high'],
  [String(EFFORT_MAX), 'max'],
])

/** Selectable efforts advertised to the model picker. */
const REASONING: LlmModelReasoningInfo = {
  efforts: [
    { id: EFFORT_OFF, name: 'Off', description: 'Skip reasoning for simple tasks.' },
    { id: EFFORT_LOW, name: 'Low', description: 'Short reasoning for routine edits.' },
    { id: EFFORT_HIGH, name: 'High', description: 'Deeper reasoning for hard problems.' },
    { id: EFFORT_MAX, name: 'Max', description: 'DeepSeek V4 series maximum effort.' },
  ],
  defaultEffort: EFFORT_HIGH,
}

/** Body sent to the coordinator's chat/completions entrypoint. */
interface ChatRequestBody {
  model: string
  messages: ChatMessage[]
  stream: true
  stream_options: { include_usage: true }
  max_tokens?: number
  temperature?: number
  stop?: string[]
  tools?: ChatTool[]
  reasoning_effort?: string
  agent_hint?: AgentHintWire
}

/** Connection facts the owning plugin resolves per request. */
export interface ChatAdapterDependencies {
  /** Resolved endpoint and generation defaults for this generation. */
  options(): { baseURL: string; maxTokens?: number | undefined }
  /** Provider label shown by selectors. */
  providerName?: string
  /** Advisory model catalog for selectors. */
  discoverModels?(provider: string): readonly LlmModelInfo[] | Promise<readonly LlmModelInfo[]>
  /** Auth headers for this generation; empty sends unauthenticated requests. */
  resolveAuth(): Promise<{ headers: Record<string, string> }>
  /** Hint to merge into the body, or `undefined` to send none.
   *
   * Asynchronous so the caller can arm the control-plane barrier before the
   * request is serialized; the transport awaits it exactly once per call.
   */
  prepareHint?(
    request: { sessionId: string | undefined; purpose: GenerateOptions['purpose'] },
  ): AgentHintWire | undefined | Promise<AgentHintWire | undefined>
  /** Notified once the endpoint accepted the request, mirroring the extension `accept` transaction. */
  onAccepted?(request: { sessionId: string | undefined }): void
}

/** Narrow one provider error body to the fields this transport reports. */
interface ProviderErrorBody {
  error?: { message?: unknown }
  detail?: unknown
}

/** Compose a failure message from a non-2xx response. */
function describeFailure(status: number, body: string): string {
  let parsed: ProviderErrorBody | undefined
  try {
    parsed = JSON.parse(body) as ProviderErrorBody
  } catch {
    // Non-JSON gateway bodies are reported verbatim by the caller.
  }
  const message = typeof parsed?.error?.message === 'string'
    ? parsed.error.message
    : typeof parsed?.detail === 'string' ? parsed.detail : undefined
  return message === undefined
    ? `chat/completions request failed with HTTP ${status}`
    : `chat/completions request failed with HTTP ${status}: ${message}`
}

/** Concatenate the text blocks of one content list.
 *
 * Reasoning, image, file and tool-declaration blocks have no chat/completions
 * equivalent on the coordinator, so they are dropped rather than rejected: a
 * session that accumulated them must still be replayable.
 */
function textOf(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Collect the assistant tool calls carried by one content list. */
function toolCallsOf(blocks: readonly ContentBlock[]): ChatToolCall[] {
  const calls: ChatToolCall[] = []
  for (const block of blocks) {
    if (block.type !== 'tool-call') continue
    calls.push({
      id: String(block.id),
      type: 'function',
      function: { name: block.name, arguments: block.arguments },
    })
  }
  return calls
}

/** Map one harness message onto the chat/completions shape. */
function toChatMessage(message: GenerateOptions['messages'][number]): ChatMessage {
  const content = message.content
  if (typeof content === 'string') {
    return { role: message.role === 'assistant' ? 'assistant' : 'user', content }
  }
  const blocks = content as readonly ContentBlock[]
  const text = textOf(blocks)
  if (message.role === 'assistant') {
    const calls = toolCallsOf(blocks)
    return {
      role: 'assistant',
      ...text.length === 0 ? {} : { content: text },
      ...calls.length === 0 ? {} : { tool_calls: calls },
    }
  }
  return { role: 'user', content: text }
}

/** Build the request body for one call. */
function buildBody(
  options: GenerateOptions,
  defaults: { maxTokens?: number | undefined },
  hint: AgentHintWire | undefined,
): ChatRequestBody {
  const messages: ChatMessage[] = []
  if (options.system !== undefined && options.system.length > 0) {
    messages.push({ role: 'system', content: options.system })
  }
  for (const message of options.messages) messages.push(toChatMessage(message))
  const body: ChatRequestBody = {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  const maxTokens = options.maxTokens ?? defaults.maxTokens
  if (maxTokens !== undefined) body.max_tokens = maxTokens
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.stop !== undefined && options.stop.length > 0) body.stop = options.stop
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
  }
  if (options.reasoningEffort !== undefined) {
    const wire = EFFORT_WIRE.get(String(options.reasoningEffort))
    if (wire !== undefined) body.reasoning_effort = wire
  }
  if (hint !== undefined) body.agent_hint = hint
  return body
}

/** One decoded SSE payload, narrowed to the fields this transport reads. */
interface ChatStreamEvent {
  choices?: {
    delta?: {
      content?: unknown
      reasoning_content?: unknown
      reasoning?: unknown
      tool_calls?: unknown
    }
    finish_reason?: unknown
  }[]
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
    prompt_tokens_details?: { cached_tokens?: unknown }
    completion_tokens_details?: { reasoning_tokens?: unknown }
  }
}

/** One streamed tool-call fragment. */
interface ChatToolCallDelta {
  index?: unknown
  id?: unknown
  function?: { name?: unknown; arguments?: unknown }
}

/** Map a provider finish reason onto the harness vocabulary. */
function finishOf(raw: unknown): FinishReason {
  switch (raw) {
    case 'tool_calls':
    case 'function_call':
      return { kind: 'tool-calls' }
    case 'length':
      return { kind: 'max-tokens' }
    default:
      return { kind: 'stop' }
  }
}

/** Decode an SSE byte stream into `data:` payloads. */
async function* sseEvents(response: Response): AsyncGenerator<ChatStreamEvent, void, void> {
  if (response.body === null) throw new LlmError('chat/completions returned no body', 'TRANSPORT')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const cut = buffer.indexOf('\n\n')
        if (cut < 0) break
        const frame = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload.length === 0 || payload === '[DONE]') continue
          try {
            yield JSON.parse(payload) as ChatStreamEvent
          } catch {
            // A malformed frame is skipped; the stream stays usable.
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Translate provider events into the harness stream protocol. */
async function* translate(events: AsyncIterable<ChatStreamEvent>): AsyncGenerator<StreamChunk, void, void> {
  let textIndex: number | undefined
  let reasoningIndex: number | undefined
  const calls = new Map<number, { index: number; id: ReturnType<typeof ToolCallId>; name: string }>()
  let nextIndex = 0
  let reason: FinishReason | undefined
  let usage: TokenUsage | undefined

  for await (const event of events) {
    if (event.usage !== undefined) {
      const prompt = typeof event.usage.prompt_tokens === 'number' ? event.usage.prompt_tokens : 0
      const cached = typeof event.usage.prompt_tokens_details?.cached_tokens === 'number'
        ? event.usage.prompt_tokens_details.cached_tokens
        : 0
      const output = typeof event.usage.completion_tokens === 'number' ? event.usage.completion_tokens : 0
      usage = {
        inputTokens: Math.max(0, prompt - cached),
        outputTokens: output,
        ...cached === 0 ? {} : { cacheReadTokens: cached },
        ...typeof event.usage.total_tokens === 'number' ? { totalTokens: event.usage.total_tokens } : {},
        ...typeof event.usage.completion_tokens_details?.reasoning_tokens === 'number'
          ? { reasoningTokens: event.usage.completion_tokens_details.reasoning_tokens }
          : {},
      }
    }
    for (const choice of event.choices ?? []) {
      const delta = choice.delta
      if (delta !== undefined) {
        // Coordinators differ: some emit reasoning_content (OpenAI-compatible
        // convention), others reasoning. Accept either.
        const reasoning = typeof delta.reasoning_content === 'string'
          ? delta.reasoning_content
          : typeof delta.reasoning === 'string' ? delta.reasoning : ''
        if (reasoning.length > 0) {
          if (reasoningIndex === undefined) {
            reasoningIndex = nextIndex++
            yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
          }
          yield { type: 'reasoning-delta', index: reasoningIndex, text: reasoning }
        }
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          if (textIndex === undefined) {
            textIndex = nextIndex++
            yield { type: 'block-start', index: textIndex, blockType: 'text' }
          }
          yield { type: 'text-delta', index: textIndex, text: delta.content }
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const raw of delta.tool_calls) {
            const call = raw as ChatToolCallDelta
            const wireIndex = typeof call.index === 'number' ? call.index : 0
            let state = calls.get(wireIndex)
            if (state === undefined) {
              state = {
                index: nextIndex++,
                id: ToolCallId(typeof call.id === 'string' && call.id.length > 0 ? call.id : `call_${wireIndex}`),
                name: typeof call.function?.name === 'string' ? call.function.name : '',
              }
              calls.set(wireIndex, state)
              yield { type: 'block-start', index: state.index, blockType: 'tool-call' }
              yield { type: 'tool-call-delta', index: state.index, id: state.id, name: state.name, argumentsDelta: '' }
            }
            const args = call.function?.arguments
            if (typeof args === 'string' && args.length > 0) {
              yield { type: 'tool-call-delta', index: state.index, id: state.id, argumentsDelta: args }
            }
          }
        }
      }
      if (choice.finish_reason != null) reason = finishOf(choice.finish_reason)
    }
  }

  if (reason === undefined) reason = { kind: 'stop' }
  if (reason.kind === 'stop' && textIndex === undefined && calls.size === 0) {
    throw new LlmError('chat/completions returned no content', 'EMPTY_RESPONSE')
  }
  if (usage !== undefined) yield { type: 'usage', usage }
  yield { type: 'finish', reason }
}

/** Adapter speaking the coordinator's OpenAI chat/completions entrypoint. */
export class ChatCompletionsAdapter extends LlmAdapter {
  readonly #dependencies: ChatAdapterDependencies

  constructor(dependencies: ChatAdapterDependencies) {
    super()
    this.#dependencies = dependencies
  }

  override providerInfo(provider: string) {
    return { id: provider, name: this.#dependencies.providerName ?? 'DeepSeek (agent-hint)' }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return await this.#dependencies.discoverModels?.(provider) ?? []
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(this.#modelInfo(provider, model))
  }

  override prepareCall(provider: string, model: string): Promise<PreparedAdapterCall> {
    const connection = this.#dependencies.options()
    return Promise.resolve({
      model: this.#modelInfo(provider, model),
      stream: options => this.#generate(options, connection),
    })
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.#generate(options, this.#dependencies.options())
  }

  #modelInfo(provider: string, model: string): LlmResolvedModelInfo {
    const connection = this.#dependencies.options()
    const catalog: DeepSeekCatalogModel = {
      id: model,
      ...connection.maxTokens === undefined ? {} : { maxTokens: connection.maxTokens },
    }
    return { ...catalogModelInfo(provider, catalog), reasoning: REASONING }
  }

  async *#generate(
    options: GenerateOptions,
    connection: { baseURL: string; maxTokens?: number | undefined },
  ): AsyncGenerator<StreamChunk, void, void> {
    options.signal?.throwIfAborted()
    const request = {
      sessionId: options.sessionId === undefined ? undefined : String(options.sessionId),
      purpose: options.purpose,
    }
    const hint = await this.#dependencies.prepareHint?.(request)
    const body = buildBody(options, connection, hint)
    const auth = await this.#dependencies.resolveAuth()
    // The coordinator mounts OpenAI routes under `/v1`; a baseURL that already
    // names that root must not grow a second one.
    const root = connection.baseURL.replace(/\/+$/, '')
    const url = `${root.endsWith('/v1') ? root : `${root}/v1`}/chat/completions`
    let response: Response
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
      })
    } catch (error) {
      if (options.signal?.aborted) throw new LlmError('chat/completions request aborted', 'ABORTED', { cause: error })
      throw new LlmError('chat/completions transport failed', 'TRANSPORT', { cause: error })
    }
    if (!response.ok) {
      throw new LlmError(describeFailure(response.status, await response.text()), 'INVALID_RESPONSE')
    }
    this.#dependencies.onAccepted?.(request)
    try {
      yield* translate(sseEvents(response))
    } catch (error) {
      if (error instanceof LlmError) throw error
      if (options.signal?.aborted) throw new LlmError('chat/completions request aborted', 'ABORTED', { cause: error })
      throw new LlmError('chat/completions transport failed', 'TRANSPORT', { cause: error })
    }
  }
}
