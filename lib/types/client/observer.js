/** Invisible composer observer. Draft text stays in the browser. */
import { useEffect, useRef } from 'react';
/**
 * Observe empty-to-nonempty transitions after mount, once per transition.
 * Existing persisted drafts, session switches and whitespace-only edits do not notify.
 * @param props - session identity, public input selector and advisory notifier.
 * @returns no visible UI.
 */
export function DraftObserver({ sessionId, useInput, notify }) {
    const nonempty = useInput((input) => input.draft.trim().length > 0);
    const previous = useRef({ sessionId, nonempty });
    useEffect(() => {
        const before = previous.current;
        previous.current = { sessionId, nonempty };
        if (before.sessionId === sessionId && !before.nonempty && nonempty)
            notify(sessionId);
    }, [sessionId, nonempty, notify]);
    return null;
}
