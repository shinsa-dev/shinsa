import { Schema } from 'effect';

export const REFUSED_BLOCK_CODES = new Set([
  'invalid_blocks',
  'invalid_blocks_format',
  'msg_blocks_too_long',
]);

export const STATUS_UNAVAILABLE_CODES = new Set(['not_authorized', 'feature_disabled']);

export const SETTLED_REACTION_CODES = new Set(['no_reaction', 'already_reacted']);

export const Posted = Schema.Struct({ ts: Schema.optional(Schema.String) });

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

export interface RelayThread {
  readonly teamId: string;
  readonly channelId: string;
  readonly threadTs: string;
}
