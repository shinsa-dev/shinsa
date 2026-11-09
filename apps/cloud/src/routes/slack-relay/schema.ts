import { Schema } from 'effect';

export const REFUSED_BLOCK_CODES = new Set([
  'invalid_blocks',
  'invalid_blocks_format',
  'msg_blocks_too_long',
]);

export const STATUS_UNAVAILABLE_CODES = new Set(['not_authorized', 'feature_disabled']);

export const SETTLED_REACTION_CODES = new Set(['no_reaction', 'already_reacted']);

export const Posted = Schema.Struct({ ts: Schema.optional(Schema.String) });

export interface RelayThread {
  readonly teamId: string;
  readonly channelId: string;
  readonly threadTs: string;
}

export const Notified = Schema.Struct({
  ts: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
});

export const DIRECTORY_PAGE_SIZE = 200;

export const DIRECTORY_PAGE_LIMIT = 10;

export const SLACKBOT_USER_ID = 'USLACKBOT';

export const DIRECTORY_CHANNEL_TYPES = 'public_channel';

export const SHARED_CHANNEL_TYPES = 'private_channel';

export interface PagedAnswer {
  readonly response_metadata?: { readonly next_cursor?: string | undefined } | undefined;
}

const NextCursor = Schema.optional(Schema.Struct({ next_cursor: Schema.optional(Schema.String) }));

const Name = Schema.optional(Schema.NullOr(Schema.String));

export const ChannelPage = Schema.Struct({
  channels: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, is_member: Schema.optional(Schema.Boolean) })
  ),
  response_metadata: NextCursor,
});

export const MemberPage = Schema.Struct({
  members: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Name,
      deleted: Schema.optional(Schema.Boolean),
      is_bot: Schema.optional(Schema.Boolean),
      profile: Schema.optional(
        Schema.Struct({ display_name: Name, real_name: Name, image_72: Schema.optional(Schema.String) })
      ),
    })
  ),
  response_metadata: NextCursor,
});

export const ChannelInfo = Schema.Struct({
  channel: Schema.Struct({
    id: Schema.String,
    is_private: Schema.optional(Schema.Boolean),
    is_im: Schema.optional(Schema.Boolean),
    is_mpim: Schema.optional(Schema.Boolean),
  }),
});

export const PersonInfo = Schema.Struct({
  user: Schema.Struct({
    deleted: Schema.optional(Schema.Boolean),
    is_bot: Schema.optional(Schema.Boolean),
  }),
});

export const NOT_A_CHANNEL = 'That is not a Slack channel.';

export const NOT_A_PERSON = 'Slack could not find that person.';

export const PERSON_DEACTIVATED = 'That person’s Slack account is deactivated.';

export const PRIVATE_CHANNEL_REFUSED =
  'Shinsa posts in a private channel only when the Slack account connected to this machine is in it.';

export const NOTIFY_REFUSALS: Readonly<Record<string, string>> = {
  not_in_channel: 'The Shinsa app is not in that channel. Invite it with /invite @Shinsa.',
  channel_not_found: 'Slack could not find that channel or person.',
  is_archived: 'That Slack channel is archived.',
  user_not_found: NOT_A_PERSON,
  user_disabled: PERSON_DEACTIVATED,
};
