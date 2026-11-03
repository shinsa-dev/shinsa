import type {
  Bytes,
  ChatEntry,
  PullRequest,
  Repo,
  ShareFileType,
  ShareLiveView,
  SharePreset,
  ShinsaCommand,
  ShinsaState,
  Task,
} from '@shinsa/core';
import type { DomainError } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { EffectContext, Engine } from '../../runtime/engine.ts';
import type { EffectFailed } from '../../runtime/failures/schema.ts';
import type { EvidenceStore } from '../../store/evidence/index.ts';
import type { ChannelPeer } from '../channel.ts';
import type { Remote } from '../index.ts';
import type { HelloAnswer, ShareChannel } from '../share-channel.ts';

export const SHARE_NOT_PAIRED =
  'Turn on remote access in Settings → General to share this task. Its link works once this machine is paired.';

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

export interface ShareGitHub {
  readDiff: (repo: Repo, number: number) => Promise<string>;
  readFile: (repo: Repo, ref: string, path: string) => Promise<string>;
}

export interface ShareWorktree {
  readBase: (repo: Repo, task: Task) => Promise<string>;
  readPatch: (worktree: string, base: string) => Promise<string>;
  readFile: (worktree: string, path: string) => Promise<string>;
}

export interface ShareTranscripts {
  listEntries: (runId: string) => ChatEntry[];
  subscribe: (listener: (runId: string) => void) => () => void;
}

export interface SharedCode {
  files: Record<string, string>;
}

export interface ShareEffects {
  link: (taskId: string, context: EffectContext) => Promise<void>;
}

export interface ShareLinks {
  acceptsShare: (shareId: string) => boolean;
  openChannel: (peer: ChannelPeer, shareId: string) => ShareChannel;
  closeChannel: (channel: ShareChannel) => void;
}

export interface SharesOptions {
  engine: Engine;
  remote: Remote;
  evidence: EvidenceStore;
  transcripts: ShareTranscripts;
  github?: ShareGitHub;
  worktree?: ShareWorktree;
  now?: () => number;
  random?: (bytes: number) => Uint8Array<ArrayBuffer>;
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

export interface ShareLive {
  readonly view: ShareLiveView;
  readonly files: readonly ShareFile[];
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

type RemoteFile = Remote['store']['file'];

type ShareAuthorizer = (hello: string) => Effect.Effect<HelloAnswer<string>>;

export interface SharesDefinition {
  readonly now: Effect.Effect<number>;
  readonly random: (bytes: number) => Effect.Effect<Uint8Array<ArrayBuffer>>;
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (command: ShinsaCommand, id?: string) => Effect.Effect<void, ShareDispatchFailed>;
  readonly remoteFile: Effect.Effect<RemoteFile>;
  readonly remoteEnabled: Effect.Effect<boolean>;
  readonly appOrigin: Effect.Effect<string>;
  readonly machineName: Effect.Effect<ReturnType<Remote['snapshot']>['machineName']>;
  readonly acquireAccess: (close: Effect.Effect<void>) => Effect.Effect<Effect.Effect<void>>;
  readonly createChannel: (peer: ChannelPeer, authorize: ShareAuthorizer) => Effect.Effect<ShareChannel>;
  readonly selectEvidenceFile: (name: string) => Effect.Effect<string | null>;
  readonly listEntries: (runId: string) => Effect.Effect<ChatEntry[]>;
  readonly github: ShareCodeSource | null;
  readonly worktree: ShareWorkingSource | null;
}

export interface SharesHandle {
  readonly syncRemote: Effect.Effect<void>;
  readonly syncChannels: Effect.Effect<void>;
  readonly pushTranscript: (runId: string) => Effect.Effect<void>;
  readonly acceptsShare: (shareId: string) => Effect.Effect<boolean>;
  readonly openChannel: (peer: ChannelPeer, shareId: string) => Effect.Effect<ShareChannel>;
  readonly closeChannel: (channel: ShareChannel) => Effect.Effect<void>;
  readonly link: (
    taskId: string,
    context: EffectContext
  ) => Effect.Effect<void, EffectFailed | ShareDispatchFailed>;
  readonly resolveLive: (taskId: string, preset?: SharePreset) => Effect.Effect<ShareLive, DomainError>;
}
