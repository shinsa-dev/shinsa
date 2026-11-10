import { Duration, Schema } from 'effect';

export const CdpReply = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Number,
    result: Schema.optional(Schema.Unknown),
    error: Schema.optional(Schema.Struct({ message: Schema.String })),
  })
);
export type CdpReply = typeof CdpReply.Type;

export const CdpFailureReason = Schema.Literals(['unreachable', 'closed', 'refused', 'timeout']);
export type CdpFailureReason = typeof CdpFailureReason.Type;

export class CdpFailed extends Schema.TaggedError<CdpFailed, { readonly brand: unique symbol }>()(
  'CdpFailed',
  { method: Schema.String, reason: CdpFailureReason, message: Schema.String }
) {}

export const CDP_TIMEOUT = Duration.seconds(15);

export const CDP_UNREACHABLE_MESSAGE = 'The browser could not be reached.';

export const CDP_CLOSED_MESSAGE = 'The browser closed the connection before it answered.';

export const CDP_TIMEOUT_MESSAGE = 'The browser did not answer in time.';
