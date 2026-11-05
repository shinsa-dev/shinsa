import { Schema } from 'effect';
import { NullByDefault, Salvaged, SalvagedItems, SalvagedOrNull, Truncated } from '../domain/salvage.ts';

export const SLACK_LIMITS = {
  text: 4000,
  userName: 120,
  id: 64,
  permalink: 2000,
  channelName: 80,
  threadMessages: 100,
  threadChars: 12_000,
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
  channelName: SalvagedOrNull(Truncated(SLACK_LIMITS.channelName).check(Schema.isNonEmpty())),
  thread: SalvagedItems(SlackThreadMessage, SLACK_LIMITS.threadMessages),
});

export type SlackMention = typeof SlackMention.Type;

export const SlackEvaluationReply = Schema.Struct({ decision: Schema.Literals(['task', 'none']) });

export type SlackEvaluation = (typeof SlackEvaluationReply.Type)['decision'];

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
