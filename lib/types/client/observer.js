/** Invisible composer observer. Draft text stays in the browser. */
import { useEffect, useRef } from 'react';
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
export function DraftObserver({ sessionId, useInput, notify }) {
    const length = useInput((input) => input.draft.trim().length);
    const previous = useRef({ sessionId, length });
    useEffect(() => {
        const before = previous.current;
        previous.current = { sessionId, length };
        if (before.sessionId !== sessionId)
            return;
        if (before.length === 0 && length > 0)
            notify(sessionId);
    }, [sessionId, length, notify]);
    return null;
}
