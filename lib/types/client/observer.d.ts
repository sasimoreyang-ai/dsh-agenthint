import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Framework input props and one plugin-owned advisory notification callback. */
export type DraftObserverProps = Pick<PropsRuntime<'conversation.input.overlay'>, 'sessionId' | 'useInput'> & {
    notify: (sessionId: string) => void;
};
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
export declare function DraftObserver({ sessionId, useInput, notify }: DraftObserverProps): null;