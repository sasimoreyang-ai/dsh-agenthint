/** Add hints to the host's existing Messages requests without owning a model route. */
import type { Context } from '@deepseek-ai/cordis';
import type { AgentHintCacheControl } from './types.ts';
export declare function installInheritedHints(ctx: Context, cacheControl?: AgentHintCacheControl): void;
