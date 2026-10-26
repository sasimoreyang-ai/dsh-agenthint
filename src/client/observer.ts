/** Invisible composer observer. Draft text stays in the browser. */
import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Framework input props and plugin-owned advisory notification callbacks. */
export type DraftObserverProps = Pick<PropsRuntime<'conversation.input.overlay'>, 'sessionId' | 'useInput'> & {
  notify: (sessionId: string) => void
  activate: (sessionId: string) => void
}

/**
 * Announce the visible composer on mount and session change, independently of
 * its draft. This also covers a paste batched with navigation or preceding mount.
 * Draft notifications still require an observed empty-to-nonempty transition;
 * persisted drafts and whitespace-only edits are not classified as typing.
 * @param props - session identity, public input selector and advisory notifier.
 * @returns no visible UI.
 */
export function DraftObserver({ sessionId, useInput, notify, activate }: DraftObserverProps): null {
  const nonempty = useInput((input: InputState) => input.draft.trim().length > 0)
  const previous = useRef({ sessionId, nonempty })
  useEffect(() => { activate(sessionId) }, [sessionId, activate])
  useEffect(() => {
    const before = previous.current
    previous.current = { sessionId, nonempty }
    if (before.sessionId === sessionId && !before.nonempty && nonempty) notify(sessionId)
  }, [sessionId, nonempty, notify])
  return null
}
