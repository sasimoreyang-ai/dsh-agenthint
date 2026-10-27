/** Invisible composer observer. Draft text stays in the browser. */
import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Framework input props and one plugin-owned advisory notification callback. */
export type DraftObserverProps = Pick<PropsRuntime<'conversation.input.overlay'>, 'sessionId' | 'useInput'> & {
  notify: (sessionId: string) => void
}

/**
 * Announce draft content once a session's composer goes from empty to non-empty.
 *
 * Opening or switching to a session does NOT notify: navigating to an old
 * conversation must not trigger resume on its own. The first character typed or
 * the first pasted block both produce the same empty-to-nonempty transition, so
 * paste is covered without a separate signal. Whitespace-only edits and drafts
 * that were already non-empty when the session was mounted do not notify.
 * @param props - session identity, public input selector and advisory notifier.
 * @returns no visible UI.
 */
export function DraftObserver({ sessionId, useInput, notify }: DraftObserverProps): null {
  const length = useInput((input: InputState) => input.draft.trim().length)
  const previous = useRef({ sessionId, length })
  useEffect(() => {
    const before = previous.current
    previous.current = { sessionId, length }
    if (before.sessionId !== sessionId) return
    if (before.length === 0 && length > 0) notify(sessionId)
  }, [sessionId, length, notify])
  return null
}