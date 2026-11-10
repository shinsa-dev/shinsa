import { Option, Schema } from 'effect';
import type { SlackThreadRef } from '../domain/slack.ts';
import { SlackChannelMessage, SlackMention } from './schema.ts';

export const SLACK_ENGINE_EVENTS_PATH = '/api/slack/events';

export const SLACK_ENGINE_MESSAGES_PATH = '/api/slack/messages';

const decodeSlackMention = Schema.decodeUnknownOption(SlackMention);

export function parseSlackMention(value: unknown): SlackMention | null {
  return Option.getOrNull(decodeSlackMention(value));
}

export function resolveSlackMentionThread(mention: SlackMention): SlackThreadRef {
  return { teamId: mention.teamId, channelId: mention.channelId, threadTs: mention.threadTs };
}

const decodeSlackChannelMessage = Schema.decodeUnknownOption(SlackChannelMessage);

export function parseSlackChannelMessage(value: unknown): SlackChannelMessage | null {
  return Option.getOrNull(decodeSlackChannelMessage(value));
}

export function resolveSlackMessageKey(
  message: Pick<SlackChannelMessage, 'teamId' | 'channelId' | 'messageTs'>
) {
  return `${message.teamId}:${message.channelId}:${message.messageTs}`;
}
