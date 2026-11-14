import { AppUpdateChannel } from '@shinsa/core/engine-api/schema';
import { Schema, SchemaGetter } from 'effect';
import { CHANNELS } from '../bridge/schema.ts';
import { NoticePayload } from '../notifications/schema.ts';
import type { SenderFrame } from '../window/schema.ts';

const Accept = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === true),
    encode: SchemaGetter.passthroughSupertype(),
  })
);

export const PageRequest = Schema.Union([
  Schema.Struct({ channel: Schema.Literal(CHANNELS.installUpdate) }),
  Schema.Struct({ channel: Schema.Literal(CHANNELS.checkForUpdates) }),
  Schema.Struct({ channel: Schema.Literal(CHANNELS.updateChannel), payload: AppUpdateChannel }),
  Schema.Struct({ channel: Schema.Literal(CHANNELS.downgrade), payload: Accept }),
  Schema.Struct({ channel: Schema.Literal(CHANNELS.badge), payload: Schema.Unknown }),
  Schema.Struct({ channel: Schema.Literal(CHANNELS.notify), payload: NoticePayload }),
  Schema.Struct({ channel: Schema.Literal(CHANNELS.notificationSettings) }),
]);

export type PageRequest = typeof PageRequest.Type;

export const PAGE_REQUEST_CHANNELS = [
  CHANNELS.installUpdate,
  CHANNELS.checkForUpdates,
  CHANNELS.updateChannel,
  CHANNELS.downgrade,
  CHANNELS.badge,
  CHANNELS.notify,
  CHANNELS.notificationSettings,
] as const;

export interface PageMessage {
  readonly frame: SenderFrame;
  readonly channel: string;
  readonly payload: unknown;
}
