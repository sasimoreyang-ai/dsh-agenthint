import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Framework input props and plugin-owned advisory notification callbacks. */
export type DraftObserverProps = Pick<PropsRuntime<'conversation.input.overlay'>, 'sessionId' | 'useInput'> & {
    notify: (sessionId: string) => void;
    activate: (sessionId: string) => void;
};
/**
 * Announce the visible composer on mount and session change, independently of
 * its draft. This also covers a paste batched with navigation or preceding mount.
 * Draft notifications still require an observed empty-to-nonempty transition;
 * persisted drafts and whitespace-only edits are not classified as typing.
 * @param props - session identity, public input selector and advisory notifier.
 * @returns no visible UI.
 */
export declare function DraftObserver({ sessionId, useInput, notify, activate }: DraftObserverProps): null;
