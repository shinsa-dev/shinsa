import { type Effect, Schema, SchemaGetter, SchemaTransformation, type Stream } from 'effect';
import { AppPath } from '../navigation/schema.ts';

const NOTICE_LIMITS = { title: 120, body: 240, tag: 120 } as const;

export const NOTIFICATION_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.Notifications-Settings.extension';

export const NoticePayload = Schema.Struct({
  title: Schema.String.pipe(Schema.decodeTo(Schema.String, SchemaTransformation.trim()))
    .check(Schema.isNonEmpty())
    .pipe(
      Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transform((title) =>
          title.length <= NOTICE_LIMITS.title
            ? title
            : `${title.slice(0, NOTICE_LIMITS.title - 1).trimEnd()}…`
        ),
        encode: SchemaGetter.passthrough(),
      })
    ),
  body: Schema.String.pipe(Schema.decodeTo(Schema.String, SchemaTransformation.trim())).pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((body) =>
        body.length <= NOTICE_LIMITS.body ? body : `${body.slice(0, NOTICE_LIMITS.body - 1).trimEnd()}…`
      ),
      encode: SchemaGetter.passthrough(),
    })
  ),
  tag: Schema.NonEmptyString.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((tag) => tag.slice(0, NOTICE_LIMITS.tag)),
      encode: SchemaGetter.passthrough(),
    })
  ),
  path: Schema.NullOr(AppPath),
});

export type DesktopNotice = typeof NoticePayload.Type;

export const BadgeCount = Schema.Int.check(Schema.isGreaterThan(0));

export const NoticeEvent = Schema.Literals(['click', 'close', 'failed']);

export type NoticeEvent = typeof NoticeEvent.Type;

export interface NativeNotice {
  readonly close: Effect.Effect<void>;
  readonly events: Stream.Stream<NoticeEvent>;
}
