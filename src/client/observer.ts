/** Invisible composer observer. Draft text stays in the browser. */
import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Framework input props and one plugin-owned notification callback. */
export type DraftObserverProps = Pick<PropsRuntime<'conversation.input.overlay'>, 'sessionId' | 'useInput'> & {
  notify: (sessionId: string) => void
}

/**
 * Observe empty-to-nonempty transitions after mount, once per transition.
 * Existing persisted drafts, session switches and whitespace-only edits do not notify.
 * @param props - session identity, public input selector and advisory notifier.
 * @returns no visible UI.
 */
export function DraftObserver({ sessionId, useInput, notify }: DraftObserverProps): null {
  const nonempty = useInput((input: InputState) => input.draft.trim().length > 0)
  const previous = useRef({ sessionId, nonempty })
  useEffect(() => {
    const before = previous.current
    previous.current = { sessionId, nonempty }
    if (before.sessionId === sessionId && !before.nonempty && nonempty) notify(sessionId)
  }, [sessionId, nonempty, notify])
  return null
}
