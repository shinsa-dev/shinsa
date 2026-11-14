import type { Bytes, PullRequest, Repo, ShareFileType, ShareLiveView, Task, ViewScope } from '@shinsa/core';
import type { DomainError } from '@shinsa/core';
import { Context, Schema } from 'effect';
import type { Effect } from 'effect';
import type { EffectAttempt } from '../../runtime/engine/schema.ts';
import type { EffectFailed } from '../../runtime/failures/schema.ts';
import type { ChannelPeer } from '../channel/schema.ts';
import type { LiveShare, ShareChannelHandle } from '../share-channel/schema.ts';

export const SHARE_NOT_PAIRED =
  'Turn on remote access in Settings → Cloud to share this task. Its link works once this machine is paired.';

export const SHARE_LINK_LOST =
  'This machine was paired with remote access again, so the old link no longer reaches it. Share this task again for a new link.';

export const SHARE_REMOTE_CHANGED = 'Remote access on the machine that shares this task was turned off.';

export const SHARE_LINK_NAME = 'share link';

export const SHARE_FILE_TYPES: Readonly<Record<string, ShareFileType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.md': 'text/plain',
  '.txt': 'text/plain',
};

export const PULL_REQUEST_CODE: ReadonlySet<PullRequest['state']> = new Set(['open', 'merged']);

export const CODE_FILE_LIMIT = 300;

export const CODE_STATUSES: ReadonlySet<string> = new Set(['modified', 'renamed']);

export interface SharedCode {
  files: Record<string, string>;
}

export class ShareCodeUnreadable extends Schema.TaggedError<
  ShareCodeUnreadable,
  { readonly brand: unique symbol }
>()('ShareCodeUnreadable', { message: Schema.String }) {}

export class ShareFileUnreadable extends Schema.TaggedError<
  ShareFileUnreadable,
  { readonly brand: unique symbol }
>()('ShareFileUnreadable', { path: Schema.String, message: Schema.String }) {}

export class ShareDispatchFailed extends Schema.TaggedError<
  ShareDispatchFailed,
  { readonly brand: unique symbol }
>()('ShareDispatchFailed', { message: Schema.String }) {}

export interface ShareCodeSource {
  readonly readDiff: (repo: Repo, number: number) => Effect.Effect<string, ShareCodeUnreadable>;
  readonly readFile: (repo: Repo, ref: string, path: string) => Effect.Effect<string, ShareCodeUnreadable>;
}

export interface ShareWorkingSource {
  readonly readBase: (repo: Repo, task: Task) => Effect.Effect<string, ShareCodeUnreadable>;
  readonly readPatch: (worktree: string, base: string) => Effect.Effect<string, ShareCodeUnreadable>;
  readonly readFile: (worktree: string, path: string) => Effect.Effect<string, ShareCodeUnreadable>;
}

export interface ShareFile {
  readonly id: string;
  readonly version: string;
  readonly type: ShareFileType;
  readonly read: Effect.Effect<Bytes, ShareFileUnreadable>;
}

export interface HashedFile {
  readonly size: number;
  readonly modifiedAt: number;
  readonly hash: string;
}

export interface CachedCode {
  readonly key: string;
  readonly files: readonly ShareFile[];
}

export interface OpenShareChannel {
  readonly shareId: string;
  readonly release: Effect.Effect<void>;
}

export interface ShareSourcesShape {
  readonly github: ShareCodeSource | null;
  readonly worktree: ShareWorkingSource | null;
}

export const ShareSources = Context.Reference<ShareSourcesShape>('shinsa/engine/remote/shares/ShareSources', {
  defaultValue: () => ({ github: null, worktree: null }),
});

export interface ShareEffects {
  link(taskId: string, attempt: EffectAttempt): Effect.Effect<void, EffectFailed | ShareDispatchFailed>;
}

export interface ShareLinks {
  acceptsShare(shareId: string): Effect.Effect<boolean>;
  openChannel(peer: ChannelPeer, shareId: string): Effect.Effect<ShareChannelHandle<string>>;
  closeChannel(channel: ShareChannelHandle<string>): Effect.Effect<void>;
}

export interface SharesHandle extends ShareEffects, ShareLinks {
  resolveLive(
    taskId: string,
    scopes?: readonly ViewScope[]
  ): Effect.Effect<LiveShare<ShareLiveView>, DomainError>;
}
