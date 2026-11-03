import {
  type MachineCredentials,
  PREVIEW_ACCESS_HEADER,
  PREVIEW_KEY_HEADER,
  type RemoteAccess,
  type ServiceDefinition,
  type ShinsaCommand,
  type ShinsaState,
  type TerminalInfo,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { Schema } from 'effect';
import type { Deferred, Effect } from 'effect';
import type { Engine, EffectContext } from '../../runtime/engine.ts';
import type { EffectFailed } from '../../runtime/failures/schema.ts';
import type { Remote } from '../index.ts';

export const PREVIEW_NOT_PAIRED =
  'Turn on remote access in Settings → General to share this preview. Its link works once this machine is paired.';

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

interface PreviewServices {
  snapshot: () => TerminalsSnapshot;
}

export interface PreviewEffects {
  link: (taskId: string, serviceId: string, context: EffectContext) => Promise<void>;
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
  answer: (request: Request, url: URL) => Promise<PreviewAnswer>;
  openSocket: (peer: PreviewPeer, upgrade: PreviewUpgrade) => PreviewRelay;
}

export interface PreviewsOptions {
  engine: Engine;
  remote: Remote;
  services: PreviewServices;
  origin: string;
  now?: () => number;
  random?: (bytes: number) => Uint8Array<ArrayBuffer>;
  fetch?: typeof fetch;
}

type PreviewFetchInit = BunFetchRequestInit;

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

export interface PreviewsDefinition {
  readonly origin: string;
  readonly now: Effect.Effect<number>;
  readonly random: (bytes: number) => Effect.Effect<Uint8Array<ArrayBuffer>>;
  readonly state: Effect.Effect<ShinsaState>;
  readonly remote: Effect.Effect<PreviewRemote>;
  readonly snapshot: Effect.Effect<TerminalsSnapshot>;
  readonly dispatch: (command: ShinsaCommand, id?: string) => Effect.Effect<void, PreviewDispatchFailed>;
  readonly fetch: (target: string, init: PreviewFetchInit) => Effect.Effect<Response, PreviewUnreachable>;
}

export interface PreviewsHandle {
  readonly subscribe: (listener: () => void) => Effect.Effect<() => void>;
  readonly syncRemote: Effect.Effect<void>;
  readonly syncSockets: Effect.Effect<void>;
  readonly resolveRemoteUrl: (info: TerminalInfo, service: ServiceDefinition) => Effect.Effect<string | null>;
  readonly link: (
    taskId: string,
    serviceId: string,
    context: EffectContext
  ) => Effect.Effect<void, EffectFailed | PreviewDispatchFailed>;
  readonly answer: (request: Request, url: URL) => Effect.Effect<PreviewAnswer>;
  readonly openSocket: (peer: PreviewPeer, upgrade: PreviewUpgrade) => Effect.Effect<PreviewRelay>;
}
