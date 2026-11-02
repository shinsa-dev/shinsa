import type { ShareLiveView, ShareMessage } from '@shinsa/core';
import { Predicate, Schedule, Schema } from 'effect';
import type { ReconnectPlan } from '@/lib/runtime/socket/schema.ts';

export const SHARE_OFFLINE =
  'The machine that shares this task is offline. This page opens it again as soon as it is back.';

export const SHARE_UNREACHABLE = 'Couldn’t reach app.shinsa.dev. This page tries again on its own.';

export const UNREADABLE_MESSAGE = 'The machine sent something this page cannot read. Reload the page.';

const SHARE_REDIAL = '1 second';

const SHARE_BACKOFF = Schedule.duration('2 seconds').pipe(
  Schedule.concat(Schedule.duration('5 seconds')),
  Schedule.concat(Schedule.spaced('10 seconds'))
);

export const SHARE_RECONNECT: ReconnectPlan = {
  first: Schedule.duration(SHARE_REDIAL).pipe(Schedule.concat(SHARE_BACKOFF)),
  backoff: SHARE_BACKOFF,
  redial: SHARE_REDIAL,
};

export const ShareLiveViewText = Schema.fromJsonString(
  Schema.Unknown.pipe(Schema.refine((value): value is ShareLiveView => Predicate.isObject(value)))
);

export class ShareDropped extends Schema.TaggedError<ShareDropped, { readonly brand: unique symbol }>()(
  'ShareDropped',
  {
    reason: Schema.String,
    connected: Schema.Boolean,
    final: Schema.Boolean,
  }
) {}

export type ShareContent = Exclude<ShareMessage, { t: 'closed' }>;

export interface ShareSession {
  welcomed(): void;
  received(message: ShareContent): boolean;
  dropped(drop: ShareDropped): void;
}
