import { Option, Schema } from 'effect';
import type { SlackThreadRef } from '../domain/slack.ts';
import { SlackMention } from './schema.ts';

export const SLACK_ENGINE_EVENTS_PATH = '/api/slack/events';

const decodeSlackMention = Schema.decodeUnknownOption(SlackMention);

export function parseSlackMention(value: unknown): SlackMention | null {
  return Option.getOrNull(decodeSlackMention(value));
}

export function resolveSlackMentionThread(mention: SlackMention): SlackThreadRef {
  return { teamId: mention.teamId, channelId: mention.channelId, threadTs: mention.threadTs };
}
