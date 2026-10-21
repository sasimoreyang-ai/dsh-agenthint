import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Framework input props and one plugin-owned notification callback. */
export type DraftObserverProps = Pick<PropsRuntime<'conversation.input.overlay'>, 'sessionId' | 'useInput'> & {
    notify: (sessionId: string) => void;
};
/**
 * Observe empty-to-nonempty transitions after mount, once per transition.
 * Existing persisted drafts, session switches and whitespace-only edits do not notify.
 * @param props - session identity, public input selector and advisory notifier.
 * @returns no visible UI.
 */
export declare function DraftObserver({ sessionId, useInput, notify }: DraftObserverProps): null;
