/**
 * DSH-facing view of the `agent_hint` wire contract.
 *
 * The shapes themselves live in `@sasimoreyang-ai/agenthint-core`, which has no
 * host dependencies. This module re-exports them unchanged so existing imports
 * keep working, and adds the one thing that is DSH-specific: the module
 * augmentation that lets the DeepSeek transport carry the field.
 *
 * @module dsh-llm-agent-hint/types
 */

export type {
  AgentHintCacheControl,
  AgentHintWire,
  ControlVerb,
  SessionControlVerb,
} from '@sasimoreyang-ai/agenthint-core'

import type { AgentHintWire } from '@sasimoreyang-ai/agenthint-core'

declare module '@deepseek-ai/dsh-deepseek-llm-api-extensions' {
  interface DeepSeekLlmApiExtensionMap {
    /** MindIE-Motor hint, contributed by the standalone route. */
    agent_hint: AgentHintWire
  }
}
