import { Schema } from 'effect';
import { Salvaged, SalvagedItems, SalvagedOrNull, Truncated } from '../domain/salvage.ts';

export const SLACK_LIMITS = {
  text: 4000,
  userName: 120,
  id: 64,
  permalink: 2000,
  threadMessages: 100,
  threadChars: 12_000,
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

export const SlackMention = Schema.Struct({
  eventId: SlackId,
  teamId: SlackId,
  channelId: SlackId,
  threadTs: SlackId,
  messageTs: SlackId,
  userId: SlackId,
  userName: Truncated(SLACK_LIMITS.userName),
  text: Truncated(SLACK_LIMITS.text),
  permalink: SalvagedOrNull(Truncated(SLACK_LIMITS.permalink).check(Schema.isStartingWith('https://'))),
  thread: SalvagedItems(SlackThreadMessage, SLACK_LIMITS.threadMessages),
});

export type SlackMention = typeof SlackMention.Type;

export const SlackDecision = Schema.Struct({ decision: Schema.Literals(['task', 'none']) });

export type SlackEvaluation = (typeof SlackDecision.Type)['decision'];
