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
  it('does not treat a persisted draft or a session switch as typing', () => {
    const notify = vi.fn()
    act(() => { tree = create(createElement(DraftObserver, props('saved draft', notify))) })
    act(() => tree!.update(createElement(DraftObserver, props('another saved draft', notify, 'session-b'))))
    expect(notify).not.toHaveBeenCalled()
  })
})
