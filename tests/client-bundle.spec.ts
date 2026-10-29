import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { create, act } from 'react-test-renderer'

describe('shipped browser factory', () => {
  it('registers a stock Slot, sends only a session id, and withdraws on unload', async () => {
    let registration: { id: string; factory: (require: (id: string) => unknown) => { apply: (ctx: Context) => void; inject: string[] } } | undefined
    runInNewContext(await readFile('lib/client.js', 'utf8'), {
      window: { __ModuleLoader__: { load: (value: typeof registration) => { registration = value } } },
      AbortController, AbortSignal,
    })
    expect(registration?.id).toBe('@sasimoreyang-ai/dsh-llm-agent-hint')
    const face = registration!.factory(id => {
      if (id !== 'react') throw new Error(`Unexpected browser external: ${id}`)
      return React
    })
    const ctx = new Context()
    const calls: unknown[][] = []
    let tree: ReturnType<typeof create> | undefined
    try {
      ctx.provide('connection', { rpc: { call: async (...args: unknown[]) => {
        calls.push(args); return { ok: true }
      } } } as never)
      let rendererRegistration: { factory: (require: NodeJS.Require) => { SlotRegistry: typeof import('@deepseek-ai/dsh-client-ui-renderer/client').SlotRegistry } } | undefined
      runInNewContext(await readFile('node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js', 'utf8'), {
        window: { __ModuleLoader__: { load: (value: typeof rendererRegistration) => { rendererRegistration = value } } },
        queueMicrotask, setTimeout, clearTimeout,
      })
      const { SlotRegistry } = rendererRegistration!.factory(createRequire(import.meta.url))
      await ctx.plugin(SlotRegistry)
      // The framework owns and declares the input overlay. The plugin contributes
      // to that public declaration; it does not replace the composer.
      ctx.slots.register({ name: 'root', children: {
        'conversation.input.overlay': { kind: 'list', scope: 'session' },
      } } as never, () => null)
      const fiber = await ctx.plugin(face)
      expect(ctx.slots.entries('conversation.input.overlay')).toHaveLength(0)
      ctx.provide('remote.agentHintSignals', {} as never)
      await vi.waitFor(() => expect(ctx.slots.entries('conversation.input.overlay')).toHaveLength(1))
      const entries = ctx.slots.entries('conversation.input.overlay')
      expect(entries).toHaveLength(1)
      const entry = entries[0]
      const component = entry.component as React.ComponentType<any>
      let draft = ''
      const props = { sessionId: 'private-session',
        useInput: (select: (s: { draft: string }) => unknown) => select({ draft }),
        ...entry.inject!(),
      }
      act(() => { tree = create(React.createElement(component, props)) })
      // Mounting a session must not announce anything on its own.
      expect(calls).toHaveLength(0)
      draft = 'private draft text'
      act(() => tree!.update(React.createElement(component, props)))
      expect(calls).toHaveLength(1)
      expect(calls[0].slice(0, 3)).toEqual(['/api', 'agentHintSignals/composing', { request: { sessionId: 'private-session' } }])
      draft += ' continues'
      act(() => tree!.update(React.createElement(component, props)))
      expect(calls).toHaveLength(1)
      // Switching sessions is silent; only the first edit in the new session notifies.
      act(() => tree!.update(React.createElement(component, { ...props, sessionId: 'revisit-session' })))
      expect(calls).toHaveLength(1)
      // A restored/non-empty baseline can be edited without clearing first.
      draft = draft.replace('private', 'changed')
      act(() => tree!.update(React.createElement(component, { ...props, sessionId: 'revisit-session' })))
      expect(calls).toHaveLength(2)
      expect(calls[1].slice(0, 3)).toEqual(['/api', 'agentHintSignals/composing', { request: { sessionId: 'revisit-session' } }])
      expect(JSON.stringify(calls)).not.toContain('private draft text')
      expect(JSON.stringify(calls)).not.toContain('changed draft text')
      await fiber.dispose()
      expect(ctx.slots.entries('conversation.input.overlay')).toHaveLength(0)
      act(() => tree!.update(React.createElement(component, { ...props, sessionId: 'after-unload' })))
      expect(calls).toHaveLength(2)
    } finally {
      act(() => tree?.unmount())
      await ctx.fiber.dispose()
    }
  })
})
