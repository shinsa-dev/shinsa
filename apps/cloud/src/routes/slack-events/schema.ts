import type { SlackAnswer } from '@shinsa/core';
import { Schema } from 'effect';

export const SLACK_NAMED_USERS_LIMIT = 30;

export const RESPONSE_URL_ORIGIN = 'https://hooks.slack.com/';

const Id = Schema.NonEmptyString;

const Text = Schema.optional(Schema.String);

export const JsonObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

export const EventEnvelope = Schema.Struct({
  type: Schema.String,
  challenge: Schema.optional(Schema.Unknown),
  event_id: Schema.optional(Id),
});

export const UninstallEvent = Schema.Struct({
  team_id: Id,
  event: Schema.Union([
    Schema.Struct({ type: Schema.Literal('app_uninstalled') }),
    Schema.Struct({
      type: Schema.Literal('tokens_revoked'),
      tokens: Schema.Struct({ bot: Schema.NonEmptyArray(Schema.Unknown) }),
    }),
  ]),
});

export const MentionEnvelope = Schema.Struct({
  event_id: Id,
  team_id: Id,
  event: Schema.Struct({
    type: Schema.Literal('app_mention'),
    bot_id: Schema.optionalKey(Schema.Never),
    subtype: Schema.optionalKey(Schema.Never),
    channel: Id,
    ts: Id,
    user: Id,
    thread_ts: Text,
    text: Text,
  }),
});

export type MentionEnvelope = typeof MentionEnvelope.Type;

export const ThreadMessage = Schema.Struct({
  ts: Id,
  user: Schema.optional(Id),
  bot_id: Schema.optional(Id),
  username: Schema.optional(Id),
  bot_profile: Schema.optional(Schema.Struct({ name: Schema.optional(Id) })),
  text: Text,
});

export type ThreadMessage = typeof ThreadMessage.Type;

export const Replies = Schema.Struct({ messages: Schema.optional(Schema.Array(Schema.Unknown)) });

export const Permalink = Schema.Struct({ permalink: Schema.optional(Schema.String) });

export const InteractionForm = Schema.Struct({ payload: Schema.String });

export const BlockActions = Schema.Struct({
  type: Schema.Literal('block_actions'),
  response_url: Schema.String,
  trigger_id: Schema.optional(Id),
  team: Schema.Struct({ id: Id }),
  user: Schema.Struct({ id: Id }),
  channel: Schema.Struct({ id: Id }),
  message: Schema.Struct({
    ts: Id,
    thread_ts: Text,
    text: Text,
    blocks: Schema.optional(Schema.Array(Schema.Unknown)),
  }),
  actions: Schema.NonEmptyArray(
    Schema.Struct({ action_id: Schema.String, value: Schema.String, action_ts: Schema.optional(Id) })
  ),
});

export type BlockActions = typeof BlockActions.Type;

export interface MentionEvent {
  readonly eventId: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly ts: string;
  readonly threadTs: string;
  readonly userId: string;
  readonly text: string;
}

export interface ThreadEntry {
  readonly ts: string;
  readonly userId: string;
  readonly text: string;
  readonly botName: string | null;
}

export interface AnswerClick {
  readonly answer: SlackAnswer;
  readonly responseUrl: string;
  readonly message: { readonly text: string; readonly blocks: ReadonlyArray<unknown> };
}
