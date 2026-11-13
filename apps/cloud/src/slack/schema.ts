import { Duration, Schema } from 'effect';

export const SLACK_EVENT_BODY_LIMIT_BYTES = 1024 * 1024;

export const SIGNATURE_WINDOW = Duration.minutes(5);

export const TIMESTAMP_PATTERN = /^\d{1,12}$/;

export const SETTLED_REVOKE_CODES: ReadonlySet<string> = new Set([
  'invalid_auth',
  'token_revoked',
  'account_inactive',
  'not_authed',
]);

export const MEMBERSHIP_WINDOW = Duration.minutes(5);

export const MEMBERSHIP_DENIED_CODES: ReadonlySet<string> = new Set([
  ...SETTLED_REVOKE_CODES,
  'token_expired',
  'missing_scope',
  'channel_not_found',
]);

export const CHANNEL_PAGE_SIZE = 200;

export const Conversation = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  is_private: Schema.optional(Schema.Boolean),
});

export type Conversation = typeof Conversation.Type;

export const Conversations = Schema.Struct({
  channels: Schema.optional(Schema.Array(Conversation)),
  response_metadata: Schema.optional(Schema.Struct({ next_cursor: Schema.optional(Schema.String) })),
});

export const ChannelMembership = Schema.Struct({
  channel: Schema.optional(Schema.Struct({ is_member: Schema.optional(Schema.Boolean) })),
});

export interface PrivateMemberships {
  readonly member: ReadonlySet<string>;
  readonly failed: string | null;
}

export type ChannelAccess = 'member' | 'denied' | 'unknown';
