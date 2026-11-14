import {
  type MachineCredentials,
  PREVIEW_ACCESS_HEADER,
  PREVIEW_KEY_HEADER,
  type RemoteAccess,
} from '@shinsa/core';
import { Context, Schema } from 'effect';
import type { Deferred, Effect } from 'effect';
import type { EffectAttempt } from '../../runtime/engine/schema.ts';
import type { EffectFailed } from '../../runtime/failures/schema.ts';

export const PREVIEW_NOT_PAIRED =
  'Turn on remote access in Settings → Connections to share this preview. Its link works once this machine is paired.';

export const PREVIEW_LINK_LOST =
  'This machine was paired with remote access again, so the old link no longer reaches it. Share this preview again for a new link.';

export const PREVIEW_NO_URL =
  'This service has no preview URL, so there is no page to share. Give it one in its settings, then share it again.';

export const PREVIEW_DROPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'cdn-loop',
  PREVIEW_KEY_HEADER,
  PREVIEW_ACCESS_HEADER,
]);

export const PREVIEW_SOCKET_HEADERS: ReadonlySet<string> = new Set([
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
]);

export const PREVIEW_SENDABLE_CLOSE = { min: 1000, max: 4999, reserved: new Set([1004, 1005, 1006, 1015]) };

export class PreviewDispatchFailed extends Schema.TaggedError<
  PreviewDispatchFailed,
  { readonly brand: unique symbol }
>()('PreviewDispatchFailed', {
  message: Schema.String,
}) {}

export class PreviewUnreachable extends Schema.TaggedError<
  PreviewUnreachable,
  { readonly brand: unique symbol }
>()('PreviewUnreachable', {
  message: Schema.String,
}) {}

export class PreviewAddressFailed extends Schema.TaggedError<
  PreviewAddressFailed,
  { readonly brand: unique symbol }
>()('PreviewAddressFailed', {
  message: Schema.String,
}) {}

export interface PreviewEffects {
  link(
    taskId: string,
    serviceId: string,
    attempt: EffectAttempt
  ): Effect.Effect<void, EffectFailed | PreviewDispatchFailed>;
}

export interface PreviewUpgrade {
  previewId: string;
  userId: string | null;
  target: string;
  headers: Record<string, string>;
  protocols: string[];
}

export type PreviewAnswer =
  | { kind: 'response'; response: Response }
  | { kind: 'upgrade'; upgrade: PreviewUpgrade };

export interface PreviewPeer {
  send: (data: string | Uint8Array) => void;
  close: (code: number, reason: string) => void;
}

export interface PreviewRelay {
  send: (data: string | Uint8Array) => void;
  close: () => void;
}

export interface PreviewLinks {
  answer(request: Request, url: URL): Effect.Effect<PreviewAnswer>;
  openSocket(peer: PreviewPeer, upgrade: PreviewUpgrade): Effect.Effect<PreviewRelay>;
}

export interface PreviewRemote {
  readonly enabled: boolean;
  readonly credentials: MachineCredentials | null;
  readonly access: RemoteAccess | null;
}

export interface PreviewShareTarget {
  readonly taskId: string;
  readonly serviceId: string;
  readonly key: string;
}

export interface PrivateRun {
  readonly serviceId: string;
  readonly taskId: string | null;
}

export interface PreviewTarget {
  readonly serviceId: string;
  readonly taskId: string | null;
  readonly userId: string | null;
}

export interface LiveSocket {
  readonly previewId: string;
  readonly userId: string | null;
  readonly peer: PreviewPeer;
  readonly upstream: WebSocket;
}

export interface PrivateAddresses {
  readonly connectKey: string | null;
  readonly ids: ReadonlyMap<string, string>;
  readonly runs: ReadonlyMap<string, PrivateRun>;
  readonly pending: ReadonlyMap<string, Deferred.Deferred<void>>;
}

export const PreviewFetch = Context.Reference<typeof fetch>('shinsa/engine/remote/previews/PreviewFetch', {
  defaultValue: () => fetch,
});

export interface PreviewsHandle extends PreviewEffects, PreviewLinks {}
