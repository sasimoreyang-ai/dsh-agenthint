import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Framework input props and one plugin-owned advisory notification callback. */
export type DraftObserverProps = Pick<PropsRuntime<'conversation.input.overlay'>, 'sessionId' | 'useInput'> & {
    notify: (sessionId: string) => void;
};
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
export declare function DraftObserver({ sessionId, useInput, notify }: DraftObserverProps): null;
