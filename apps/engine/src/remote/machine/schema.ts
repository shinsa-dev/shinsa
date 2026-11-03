import type { GuestActor, MachineCredentials, TaskGuest } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { ChannelHub } from '../channel/schema.ts';
import type { RemoteControl } from '../client/index.ts';
import type { MachineKeyPair } from '../pairing/schema.ts';
import type { RemoteStore } from '../store.ts';
import type { TunnelConnectorLayer, TunnelPing } from '../tunnel/index.ts';

export const REMOTE_ACCESS_CHANGED = 'Remote access to this machine changed.';

export const SECRET_BYTES = 32;

export const MAX_REQUESTS = 20;

export const HANDOFF_NOT_ENABLED =
  'Turn on remote access in Settings → General to hand off this task. Its link works once this machine is reachable.';

export const HANDOFF_UNAVAILABLE = 'This machine cannot hand off tasks right now. Try again in a moment.';

export const GUEST_FALLBACK_LOGIN = 'guest';

export class RemoteKeyUnreadable extends Schema.TaggedError<
  RemoteKeyUnreadable,
  { readonly brand: unique symbol }
>()('RemoteKeyUnreadable', { message: Schema.String }) {}

export class HandoffClaimFailed extends Schema.TaggedError<
  HandoffClaimFailed,
  { readonly brand: unique symbol }
>()('HandoffClaimFailed', { message: Schema.String }) {}

export class RemoteUrlUnopened extends Schema.TaggedError<
  RemoteUrlUnopened,
  { readonly brand: unique symbol }
>()('RemoteUrlUnopened', { message: Schema.String }) {}

export interface RemoteOptions {
  path: string;
  control?: RemoteControl;
  connector: TunnelConnectorLayer;
  ping?: TunnelPing;
  localUrl: () => string;
  version: string;
  maxBodyBytes: number;
  now?: () => number;
  machineName: string;
  openUrl: (url: string) => Promise<void>;
}

export interface ChannelParts {
  readonly hub: ChannelHub;
  readonly respond: (request: Request, guest: GuestActor | null, userId: string) => Promise<Response>;
}

export type HandoffClaimer = (taskId: string, guest: TaskGuest) => Promise<string | null>;

export type GuestLeaver = (userIds: string[]) => void;

export type HandoffClaim = (
  taskId: string,
  guest: TaskGuest
) => Effect.Effect<string | null, HandoffClaimFailed>;

interface RemoteTunnel {
  start(credentials: MachineCredentials): Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}

interface RemoteAccessLeases {
  acquire(close: Effect.Effect<void>): Effect.Effect<Effect.Effect<void>>;
  readonly end: Effect.Effect<void>;
}

export interface RemoteDefinition {
  readonly store: RemoteStore;
  readonly origin: string;
  readonly machineName: string;
  readonly version: string;
  readonly now: Effect.Effect<number>;
  readonly secret: Effect.Effect<string>;
  readonly newId: Effect.Effect<string>;
  readonly machineKey: Effect.Effect<MachineKeyPair, RemoteKeyUnreadable>;
  readonly signingKey: Effect.Effect<string, RemoteKeyUnreadable>;
  readonly openUrl: (url: string) => Effect.Effect<void, RemoteUrlUnopened>;
  readonly tunnel: RemoteTunnel;
  readonly access: RemoteAccessLeases;
}
