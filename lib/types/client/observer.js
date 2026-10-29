/** Invisible composer observer. Draft text stays in the browser. */
import { useEffect, useRef } from 'react';
/**
 * Announce the first observed non-empty draft edit in the current session.
 *
 * Opening or switching to a session does NOT notify: navigating to an old
 * conversation must not trigger resume on its own. Editing a restored draft also
 * notifies, including replacements that keep the same length. Further edits are
 * quiet until the draft is cleared. Initial content is only a baseline: the host
 * does not distinguish restored text from a paste batched with navigation/mount.
 * That case uses request-time resume unless a subsequent edit is observed.
 * @param props - session identity, public input selector and advisory notifier.
 * @returns no visible UI.
 */
export function DraftObserver({ sessionId, useInput, notify }) {
    const draft = useInput((input) => input.draft);
    const previous = useRef({ sessionId, draft, announced: false });
    useEffect(() => {
        const before = previous.current;
        const nonempty = draft.trim().length > 0;
        const announce = before.sessionId === sessionId && before.draft !== draft
            && nonempty && !before.announced;
        previous.current = { sessionId, draft,
            announced: before.sessionId === sessionId && nonempty && (before.announced || announce) };
        if (announce)
            notify(sessionId);
    }, [sessionId, draft, notify]);
    return null;
}
