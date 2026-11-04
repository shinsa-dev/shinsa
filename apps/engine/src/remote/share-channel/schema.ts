import type { Bytes, ShareFileType, ShareLiveView, ShareWelcome, TeamListView } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { ChannelPeer } from '../channel/schema.ts';

export const SHARE_GONE_REASON = 'This task is no longer shared, or the link is wrong.';

export interface LiveFile {
  id: string;
  version: string;
  type: ShareFileType;
  read: Effect.Effect<Bytes, ShareChannelBroke>;
}

export interface LiveShare<View = ShareLiveView | TeamListView> {
  view: View;
  files: LiveFile[];
}

interface ChannelGrant<Subject> {
  subject: Subject;
  welcome: ShareWelcome;
  session: CryptoKey;
}

export type HelloAnswer<Subject> = ChannelGrant<Subject> | { refused: string } | null;

export type ChannelInput = string | Bytes | ArrayBuffer | Uint8Array;

export class ShareChannelBroke extends Schema.TaggedError<
  ShareChannelBroke,
  { readonly brand: unique symbol }
>()('ShareChannelBroke', { message: Schema.String }) {}

export interface ShareChannelDefinition<Subject> {
  readonly name: string;
  readonly peer: ChannelPeer;
  readonly authorize: (hello: string) => Effect.Effect<HelloAnswer<Subject>, ShareChannelBroke>;
  readonly resolveLive: (subject: Subject) => Effect.Effect<LiveShare, ShareChannelBroke>;
}

export type ChannelState<Subject> =
  | { readonly kind: 'hello' }
  | { readonly kind: 'open'; readonly subject: Subject; readonly seal: (plain: Bytes) => Promise<Bytes> }
  | { readonly kind: 'closed' };

export interface PushState {
  readonly dirty: boolean;
  readonly running: boolean;
}

export interface ShareChannelHandle<Subject> {
  readonly subject: Effect.Effect<Subject | null>;
  readonly receive: (raw: ChannelInput) => Effect.Effect<void>;
  readonly push: Effect.Effect<void>;
  readonly end: (reason: string) => Effect.Effect<void, ShareChannelBroke>;
  readonly fail: (reason: string, detail?: string) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}
