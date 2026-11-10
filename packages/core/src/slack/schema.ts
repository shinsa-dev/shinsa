import { Schema } from 'effect';
import { NullByDefault, Salvaged, SalvagedItems, SalvagedOrNull, Truncated } from '../domain/salvage.ts';
import { RemoteUserId } from '../remote/contract.ts';

export const SLACK_LIMITS = {
  text: 4000,
  userName: 120,
  id: 64,
  permalink: 2000,
  channelName: 80,
  threadMessages: 100,
  threadChars: 12_000,
  linkedThreads: 3,
  linkedThreadChars: 6_000,
  channelMessage: 12_000,
  teamName: 120,
  channels: 1000,
  watches: 100,
} as const;

export const SLACK_VIEW_LIMITS = {
  input: 3000,
  title: 24,
  label: 2000,
  privateMetadata: 3000,
  id: 255,
} as const;

export const SlackId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(SLACK_LIMITS.id),
  Schema.isPattern(/^[A-Za-z0-9._-]+$/)
);

export const SlackThreadMessage = Schema.Struct({
  ts: SlackId,
  userId: SlackId,
  userName: Truncated(SLACK_LIMITS.userName),
  text: Truncated(SLACK_LIMITS.text),
  bot: Salvaged(Schema.Boolean, () => false),
});

export type SlackThreadMessage = typeof SlackThreadMessage.Type;

const SlackPermalink = Truncated(SLACK_LIMITS.permalink).check(Schema.isStartingWith('https://'));

const SlackChannelName = Truncated(SLACK_LIMITS.channelName).check(Schema.isNonEmpty());

export interface SlackMessageLink {
  channelId: string;
  threadTs: string;
  permalink: string;
}

export const SlackLinkedThread = Schema.Struct({
  channelId: SlackId,
  threadTs: SlackId,
  permalink: SlackPermalink,
  channelName: SalvagedOrNull(SlackChannelName),
  thread: SalvagedItems(SlackThreadMessage, SLACK_LIMITS.threadMessages),
});

export type SlackLinkedThread = typeof SlackLinkedThread.Type;

export const SlackMention = Schema.Struct({
  eventId: SlackId,
  teamId: SlackId,
  channelId: SlackId,
  threadTs: SlackId,
  messageTs: SlackId,
  userId: SlackId,
  userName: Truncated(SLACK_LIMITS.userName),
  text: Truncated(SLACK_LIMITS.text),
  permalink: SalvagedOrNull(SlackPermalink),
  channelName: SalvagedOrNull(SlackChannelName),
  thread: SalvagedItems(SlackThreadMessage, SLACK_LIMITS.threadMessages),
  linkedThreads: SalvagedItems(SlackLinkedThread, SLACK_LIMITS.linkedThreads),
  linkedUserId: NullByDefault(RemoteUserId),
});

export type SlackMention = typeof SlackMention.Type;

export const SlackChannelMessage = Schema.Struct({
  eventId: SlackId,
  teamId: SlackId,
  channelId: SlackId,
  messageTs: SlackId,
  userId: SlackId,
  userName: Truncated(SLACK_LIMITS.userName),
  bot: Salvaged(Schema.Boolean, () => false),
  text: Truncated(SLACK_LIMITS.channelMessage),
  permalink: SalvagedOrNull(SlackPermalink),
  channelName: SalvagedOrNull(SlackChannelName),
});

export type SlackChannelMessage = typeof SlackChannelMessage.Type;

export const SlackChannel = Schema.Struct({
  teamId: SlackId,
  teamName: Truncated(SLACK_LIMITS.teamName),
  channelId: SlackId,
  channelName: SlackChannelName,
  private: Schema.Boolean,
});

export type SlackChannel = typeof SlackChannel.Type;

export const SlackChannels = Schema.Struct({
  channels: Schema.Array(SlackChannel).check(Schema.isMaxLength(SLACK_LIMITS.channels)),
});

export type SlackChannels = typeof SlackChannels.Type;

export const SlackChannelWatch = Schema.Struct({ teamId: SlackId, channelId: SlackId });

export type SlackChannelWatch = typeof SlackChannelWatch.Type;

export const SlackChannelWatches = Schema.Struct({
  watches: Schema.Array(SlackChannelWatch).check(Schema.isMaxLength(SLACK_LIMITS.watches)),
});

export type SlackChannelWatches = typeof SlackChannelWatches.Type;

export const SlackEvaluationReply = Schema.Struct({ decision: Schema.Literals(['task', 'none']) });

export type SlackEvaluation = (typeof SlackEvaluationReply.Type)['decision'];

export const SlackFilterReply = Schema.Struct({ decision: Schema.Literals(['file', 'skip']) });

export type SlackFilterDecision = (typeof SlackFilterReply.Type)['decision'];

export const SLACK_DECISION_LIMITS = { choices: 100, reason: 500, decided: 300 } as const;

export const SlackDecisionValue = Schema.Struct({
  gateId: SlackId,
  decision: Schema.Literals(['approve', 'revise', 'reject', 'reply']),
  choice: NullByDefault(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(SLACK_DECISION_LIMITS.choices - 1)
    )
  ),
  planVersion: NullByDefault(Schema.Int.check(Schema.isGreaterThan(0))),
});

export type SlackDecisionValue = typeof SlackDecisionValue.Type;

const SlackDecisionPlace = Schema.Struct({
  channelId: SlackId,
  threadTs: SlackId,
  messageTs: SlackId,
});

export const SlackDecisionModal = Schema.Struct({
  ...SlackDecisionValue.fields,
  ...SlackDecisionPlace.fields,
});

export type SlackDecisionModal = typeof SlackDecisionModal.Type;

export const SlackDecision = Schema.Struct({
  ...SlackDecisionValue.fields,
  ...SlackDecisionPlace.fields,
  interactionId: SlackId,
  teamId: SlackId,
  userId: SlackId,
  response: NullByDefault(Truncated(SLACK_VIEW_LIMITS.input)),
});

export type SlackDecision = typeof SlackDecision.Type;

export const SlackDecisionReply = Schema.Union([
  Schema.Struct({ decided: Schema.Literal(true), text: Truncated(SLACK_DECISION_LIMITS.decided) }),
  Schema.Struct({ decided: Schema.Literal(false), reason: Truncated(SLACK_DECISION_LIMITS.reason) }),
]);

export type SlackDecisionReply = typeof SlackDecisionReply.Type;
