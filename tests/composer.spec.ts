import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import type { ReactTestRenderer } from 'react-test-renderer'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DraftObserver } from '../src/client/observer.ts'
import type { DraftObserverProps } from '../src/client/observer.ts'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'

let tree: ReactTestRenderer | undefined
afterEach(() => { act(() => tree?.unmount()); tree = undefined })
const noActivation = (): void => {}
function props(draft: string, notify: (id: string) => void, id = 'session-a', activate = noActivation): DraftObserverProps {
  return {
    sessionId: SessionId(id), notify, activate,
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
  it('activates persisted drafts without misclassifying their restoration as typing', () => {
    const notify = vi.fn(), activate = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('saved draft', notify, 'session-a', activate))) })
    act(() => tree!.update(createElement(DraftObserver, props('another saved draft', notify, 'session-b', activate))))
    expect(notify).not.toHaveBeenCalled()
    expect(activate.mock.calls).toEqual([['session-a'], ['session-b']])
  })
  it('activates a session when navigation and paste land in the same render', () => {
    const notify = vi.fn(), activate = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('', notify, 'pressure-session', activate))) })
    act(() => tree!.update(createElement(DraftObserver, props('revisit now', notify, 'target-session', activate))))
    expect(activate.mock.calls).toEqual([['pressure-session'], ['target-session']])
    // A restored draft and a paste are indistinguishable at this point; the
    // activation signal covers both without claiming to have observed an edit.
    expect(notify).not.toHaveBeenCalled()
    act(() => tree!.update(createElement(DraftObserver, props('revisit now!', notify, 'target-session', activate))))
    expect(activate).toHaveBeenCalledTimes(2)
  })
  it('activates even when the target observer mounts after the paste', () => {
    const notify = vi.fn(), activate = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('', notify, 'pressure-session', activate))) })
    act(() => tree!.unmount())
    act(() => { tree = create(createElement(DraftObserver, props('already pasted', notify, 'target-session', activate))) })
    expect(activate).toHaveBeenLastCalledWith('target-session')
    expect(activate).toHaveBeenCalledTimes(2)
    expect(notify).not.toHaveBeenCalled()
  })
  it('does not emit composing notifications for whitespace-only edits', () => {
    const notify = vi.fn(), activate = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('', notify, 'session-a', activate))) })
    for (const draft of [' ', '\n\t', '']) {
      act(() => tree!.update(createElement(DraftObserver, props(draft, notify, 'session-a', activate))))
    }
    expect(notify).not.toHaveBeenCalled()
    expect(activate).toHaveBeenCalledExactlyOnceWith('session-a')
  })
})
