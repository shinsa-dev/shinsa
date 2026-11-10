import type { Layer } from 'effect';
import { Schema } from 'effect';
import type { Socket } from 'effect/socket';
import type { ShinsaState, UserCommand } from '../../../packages/core/src/index.ts';

export interface PageConnection {
  start(): void;
  stop(): void;
  snapshot(): { state: ShinsaState | null };
  subscribe(listener: () => void): () => void;
  command(command: UserCommand): Promise<void>;
}

interface PageConnectionOptions {
  transport: Layer.Layer<Socket.WebSocketConstructor>;
  surface: () => 'browser';
  schedule: (flush: () => void) => void;
}

export interface PageSocketModule {
  Connection: new (options: PageConnectionOptions) => PageConnection;
}

export const PAGE_SOCKET = '../../apps/web/src/lib/connection/socket.ts';

export class NothingToMeasure extends Schema.TaggedError<
  NothingToMeasure,
  { readonly brand: unique symbol }
>()('NothingToMeasure', { message: Schema.String }) {}

export class CommandRejected extends Schema.TaggedError<CommandRejected, { readonly brand: unique symbol }>()(
  'CommandRejected',
  { message: Schema.String }
) {}

export class DataUnreadable extends Schema.TaggedError<DataUnreadable, { readonly brand: unique symbol }>()(
  'DataUnreadable',
  { message: Schema.String }
) {}

export class PushRefused extends Schema.TaggedError<PushRefused, { readonly brand: unique symbol }>()(
  'PushRefused',
  { message: Schema.String }
) {}

export const PUSH_PREVIEW_LENGTH = 200;

export const DEFAULT_SOURCE = '/tmp/shinsa-perf/real/data';

export const DEFAULT_SCRATCH = '/tmp/shinsa-perf/scratch';

export const CLICKS = 60;

export const TRANSCRIPT_APPENDS = 50;

export const EXTERNAL_APPENDS = 20;

export const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
