import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import type { ReactTestRenderer } from 'react-test-renderer'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LifecycleBridge } from '../src/lifecycle-bridge.ts'
import { DraftObserver } from '../src/client/observer.ts'
import type { DraftObserverProps } from '../src/client/observer.ts'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'

let tree: ReactTestRenderer | undefined
afterEach(() => { act(() => tree?.unmount()); tree = undefined })
function props(draft: string, notify: (id: string) => void, id = 'session-a'): DraftObserverProps {
  return {
    sessionId: SessionId(id), notify,
    useInput: ((selector: (state: Pick<InputState, 'draft'>) => unknown) => selector({ draft })) as DraftObserverProps['useInput'],
  }
}
describe('composer notifications', () => {
  it('notifies once on a real empty-to-nonempty change, not on every keystroke', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('', notify))) })
    for (const draft of [' ', 'hello', 'hello!', 'hello!!']) {
      act(() => tree!.update(createElement(DraftObserver, props(draft, notify))))
    }
    expect(notify).toHaveBeenCalledExactlyOnceWith('session-a')
    act(() => tree!.update(createElement(DraftObserver, props('', notify))))
    act(() => tree!.update(createElement(DraftObserver, props('next', notify))))
    expect(notify).toHaveBeenCalledTimes(2)
  })
  it('does not notify merely for opening or switching to a session', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('', notify, 'session-a'))) })
    act(() => tree!.update(createElement(DraftObserver, props('', notify, 'session-b'))))
    act(() => tree!.update(createElement(DraftObserver, props('', notify, 'session-c'))))
    expect(notify).not.toHaveBeenCalled()
  })
  it('does not notify when switching to a session that already holds a draft', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('saved draft', notify, 'session-a'))) })
    act(() => tree!.update(createElement(DraftObserver, props('another saved draft', notify, 'session-b'))))
    expect(notify).not.toHaveBeenCalled()
  })
  it('notifies when the first edit happens after switching to an old session', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('', notify, 'session-a'))) })
    act(() => tree!.update(createElement(DraftObserver, props('', notify, 'session-b'))))
    expect(notify).not.toHaveBeenCalled()
    act(() => tree!.update(createElement(DraftObserver, props('t', notify, 'session-b'))))
    expect(notify).toHaveBeenCalledExactlyOnceWith('session-b')
  })
  it('notifies for a paste that lands as the first non-empty content', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('', notify, 'session-a'))) })
    act(() => tree!.update(createElement(DraftObserver, props('pasted block of text', notify, 'session-a'))))
    expect(notify).toHaveBeenCalledExactlyOnceWith('session-a')
  })
  it('rebases navigation+paste and announces the next edit without requiring a clear', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('', notify, 'pressure-session'))) })
    act(() => tree!.update(createElement(DraftObserver, props('revisit now', notify, 'target-session'))))
    // Navigation alone must not notify; the observer simply rebases on the new session.
    expect(notify).not.toHaveBeenCalled()
    act(() => tree!.update(createElement(DraftObserver, props('revisit now!', notify, 'target-session'))))
    expect(notify).toHaveBeenCalledExactlyOnceWith('target-session')
    act(() => tree!.update(createElement(DraftObserver, props('revisit now!!', notify, 'target-session'))))
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('announces the first edit of a restored draft, including same-length replacement', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('saved', notify))) })
    expect(notify).not.toHaveBeenCalled()
    act(() => tree!.update(createElement(DraftObserver, props('paved', notify))))
    expect(notify).toHaveBeenCalledExactlyOnceWith('session-a')
    act(() => tree!.update(createElement(DraftObserver, props('paved more', notify))))
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('uses mounted text as a silent baseline and observes subsequent paste/edit', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('already pasted', notify))) })
    expect(notify).not.toHaveBeenCalled()
    act(() => tree!.update(createElement(DraftObserver, props('already pasted!', notify))))
    expect(notify).toHaveBeenCalledExactlyOnceWith('session-a')
  })
  it('keeps request-time resume for a navigation+paste with no subsequent edit', async () => {
    const send = vi.fn(async () => ({ status: 'accepted' as const, httpStatus: 200 }))
    const bridge = new LifecycleBridge({ client: { send } as never, pendingOpAwaitMs: 100 })
    try {
      bridge.noteOrdinaryRequest(SessionId('target'), 'm')
      bridge.noteOrdinaryRequest(SessionId('pressure'), 'm')
      await bridge.awaitPendingOp(SessionId('target'))
      const notify = (id: string) => bridge.onSessionComposing(SessionId(id))
      act(() => { tree = create(createElement(DraftObserver, props('', notify, 'pressure'))) })
      act(() => tree!.update(createElement(DraftObserver, props('pasted now', notify, 'target'))))
      expect(send.mock.calls.map(args => args[0])).toEqual(['pause'])
      const release = await bridge.beginOrdinary(SessionId('target'), 'm')
      release()
      expect(send.mock.calls.map(args => args[0])).toEqual(['pause', 'resume'])
    } finally { bridge.dispose() }
  })
  it('does not announce unchanged drafts when notifier identity changes', () => {
    const notify = vi.fn(), nextNotify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('saved', notify))) })
    act(() => tree!.update(createElement(DraftObserver, props('saved', nextNotify))))
    expect(notify).not.toHaveBeenCalled()
    expect(nextNotify).not.toHaveBeenCalled()
  })
  it('rearms after clearing a restored draft that has already announced', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('saved', notify))) })
    act(() => tree!.update(createElement(DraftObserver, props('edited', notify))))
    act(() => tree!.update(createElement(DraftObserver, props('  ', notify))))
    act(() => tree!.update(createElement(DraftObserver, props('next paste', notify))))
    expect(notify.mock.calls).toEqual([['session-a'], ['session-a']])
  })
  it('does not emit composing notifications for whitespace-only edits', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('', notify, 'session-a'))) })
    for (const draft of [' ', '\n\t', '']) {
      act(() => tree!.update(createElement(DraftObserver, props(draft, notify, 'session-a'))))
    }
    expect(notify).not.toHaveBeenCalled()
  })
})
