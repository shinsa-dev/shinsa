import { Schema } from 'effect';
import type { Bytes } from '../bytes.ts';

export const RELAY_PATH_PREFIX = '/__relay/';

export const RELAY_MACHINE_SEGMENT = 'machine';

export const RELAY_CHUNK_BYTES = 64 * 1024;

export const RELAY_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

export const RELAY_DATA_HEADER_BYTES = 5;

export const RELAY_MAX_STREAMS = 1024;

export const RELAY_BODY_WATERMARKS = { high: 1024 * 1024, low: 256 * 1024 } as const;

export const RELAY_MAX_STREAM_ID = 0xff_ff_ff_ff;

export const RELAY_CLOSE_REASON_LIMIT = 120;

export const RELAY_CLOSE = {
  normal: 1000,
  replaced: 4000,
  machineGone: 4001,
  refused: 4003,
  tooLarge: 4009,
} as const;

export const RELAY_DATA_KINDS = { binary: 1, text: 2 } as const;

export type RelayDataKind = keyof typeof RELAY_DATA_KINDS;

export const RelayStreamId = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(RELAY_MAX_STREAM_ID)
).pipe(Schema.brand('RelayStreamId'));

export type RelayStreamId = typeof RelayStreamId.Type;

export const RelayHeaders = Schema.Array(Schema.Tuple([Schema.String, Schema.String]));

export type RelayHeaders = typeof RelayHeaders.Type;

export const RelayStreamKind = Schema.Literals(['http', 'socket']);

export type RelayStreamKind = typeof RelayStreamKind.Type;

export const RelayOpen = Schema.Struct({
  type: Schema.Literal('open'),
  stream: RelayStreamId,
  kind: RelayStreamKind,
  method: Schema.String.check(Schema.isPattern(/^[A-Z]{1,16}$/)),
  path: Schema.String.check(Schema.isPattern(/^\//)),
  headers: RelayHeaders,
  address: Schema.optionalKey(Schema.String),
});

export type RelayOpen = typeof RelayOpen.Type;

export const RelayResponse = Schema.Struct({
  type: Schema.Literal('response'),
  stream: RelayStreamId,
  status: Schema.Int.check(Schema.isGreaterThanOrEqualTo(100), Schema.isLessThanOrEqualTo(599)),
  headers: RelayHeaders,
});

export type RelayResponse = typeof RelayResponse.Type;

export const RelayEnd = Schema.Struct({ type: Schema.Literal('end'), stream: RelayStreamId });

export type RelayEnd = typeof RelayEnd.Type;

export const RelayStreamClose = Schema.Struct({
  type: Schema.Literal('close'),
  stream: RelayStreamId,
  code: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1000), Schema.isLessThanOrEqualTo(4999)),
  reason: Schema.String.check(Schema.isMaxLength(RELAY_CLOSE_REASON_LIMIT)),
});

export type RelayStreamClose = typeof RelayStreamClose.Type;

export const RelayPause = Schema.Struct({ type: Schema.Literal('pause'), stream: RelayStreamId });

export const RelayResume = Schema.Struct({ type: Schema.Literal('resume'), stream: RelayStreamId });

export const RelayPing = Schema.Struct({ type: Schema.Literal('ping') });

export const RelayPong = Schema.Struct({ type: Schema.Literal('pong') });

export const RelayControl = Schema.Union([
  RelayOpen,
  RelayResponse,
  RelayEnd,
  RelayStreamClose,
  RelayPause,
  RelayResume,
  RelayPing,
  RelayPong,
]);

export type RelayControl = typeof RelayControl.Type;

export interface RelayData {
  readonly stream: RelayStreamId;
  readonly kind: RelayDataKind;
  readonly payload: Bytes;
}
