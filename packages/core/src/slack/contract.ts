import { Option, Schema } from 'effect';
import { Salvaged, SalvagedItems, SalvagedOrNull, Truncated } from '../domain/salvage.ts';
import type { SlackThreadRef } from '../domain/slack.ts';

export const SLACK_ENGINE_EVENTS_PATH = '/api/slack/events';

export const SLACK_LIMITS = {
  text: 4000,
  userName: 120,
  id: 64,
  permalink: 2000,
  threadMessages: 100,
  threadChars: 12_000,
} as const;

const SlackId = Schema.String.check(
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

const decodeSlackMention = Schema.decodeUnknownOption(SlackMention);

export function parseSlackMention(value: unknown): SlackMention | null {
  return Option.getOrNull(decodeSlackMention(value));
}

export function resolveSlackMentionThread(mention: SlackMention): SlackThreadRef {
  return { teamId: mention.teamId, channelId: mention.channelId, threadTs: mention.threadTs };
}
