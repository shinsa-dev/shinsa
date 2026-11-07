import type { SlackDecision, SlackDecisionModal } from '@shinsa/core';
import { Schema } from 'effect';
import type { Machine } from '../../store/machines/schema.ts';

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
  blocks: Schema.optional(Schema.Array(Schema.Unknown)),
  attachments: Schema.optional(Schema.Array(Schema.Unknown)),
});

export type ThreadMessage = typeof ThreadMessage.Type;

export const MessageField = Schema.Struct({ text: Schema.String });

export const MessageBlock = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.Union([Schema.String, MessageField])),
  fields: Schema.optional(Schema.Array(Schema.Unknown)),
  elements: Schema.optional(Schema.Array(Schema.Unknown)),
});

export type MessageBlock = typeof MessageBlock.Type;

export const MessageElement = Schema.Struct({
  type: Schema.String,
  text: Text,
  url: Text,
  user_id: Text,
  channel_id: Text,
  usergroup_id: Text,
  name: Text,
  range: Text,
  style: Schema.optional(Schema.Unknown),
  elements: Schema.optional(Schema.Array(Schema.Unknown)),
});

export type MessageElement = typeof MessageElement.Type;

export const MessageAttachment = Schema.Struct({
  pretext: Text,
  title: Text,
  text: Text,
  fallback: Text,
  fields: Schema.optional(Schema.Array(Schema.Unknown)),
  blocks: Schema.optional(Schema.Array(Schema.Unknown)),
});

export const AttachmentField = Schema.Struct({ title: Text, value: Text });

export const Replies = Schema.Struct({ messages: Schema.optional(Schema.Array(Schema.Unknown)) });

export const Permalink = Schema.Struct({ permalink: Schema.optional(Schema.String) });

export const ChannelInfo = Schema.Struct({
  channel: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) })),
});

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

const InputValues = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Struct({ value: Schema.optional(Schema.NullOr(Schema.String)) }))
);

export const ViewSubmission = Schema.Struct({
  type: Schema.Literal('view_submission'),
  trigger_id: Schema.optional(Id),
  team: Schema.Struct({ id: Id }),
  user: Schema.Struct({ id: Id }),
  view: Schema.Struct({
    id: Id,
    callback_id: Schema.String,
    private_metadata: Schema.String,
    state: Schema.Struct({ values: InputValues }),
  }),
});

export type ViewSubmission = typeof ViewSubmission.Type;

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

export interface SlackCard {
  readonly teamId: string;
  readonly channelId: string;
  readonly threadTs: string;
  readonly messageTs: string;
  readonly userId: string;
}

export interface CardMessage {
  readonly responseUrl: string;
  readonly text: string;
  readonly blocks: ReadonlyArray<unknown>;
}

export type Interaction =
  | { readonly kind: 'decide'; readonly decision: SlackDecision; readonly message: CardMessage }
  | {
      readonly kind: 'write';
      readonly card: SlackCard;
      readonly triggerId: string;
      readonly modal: SlackDecisionModal;
      readonly message: CardMessage;
    }
  | { readonly kind: 'submit'; readonly decision: SlackDecision };

export type DeciderCheck =
  | { readonly allowed: true; readonly machine: Machine }
  | { readonly allowed: false; readonly reason: string };

export const SLACK_DECISION_REFUSALS = {
  notLinked:
    'Connect Slack to Shinsa first. Only people with access to the machine that posted this can decide it.',
  noAccess: 'Only people with access to the machine that posted this can decide it.',
  formFailed: 'The form could not open. Try again.',
} as const;
