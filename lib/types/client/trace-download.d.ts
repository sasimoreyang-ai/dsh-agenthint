import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
interface DownloadProps extends Pick<PropsRuntime<'conversation.session.header.utilities'>, 'sessionId'> {
    download: (sessionId: string, signal: AbortSignal) => Promise<void>;
}
export declare function TraceDownload({ sessionId, download }: DownloadProps): import("react").DetailedReactHTMLElement<{
    type: string;
    onClick: () => void;
    disabled: boolean;
    title: string;
    'aria-label': string;
    'aria-busy': boolean;
    style: {
        appearance: "none";
        font: "inherit";
        fontSize: number;
        color: "inherit";
        background: string;
        border: string;
        borderRadius: number;
        padding: string;
        whiteSpace: "nowrap";
        cursor: "wait" | "pointer";
    };
}, HTMLElement>;
export declare function installTraceDownload(ctx: Context, connection: ConnectionHandle, lifetime: AbortSignal): void;
export {};
