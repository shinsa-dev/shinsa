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

export interface SlackThreadMessage {
  ts: string;
  userId: string;
  userName: string;
  text: string;
  bot: boolean;
}

export interface SlackMention extends SlackThreadRef {
  eventId: string;
  messageTs: string;
  userId: string;
  userName: string;
  text: string;
  permalink: string | null;
  thread: SlackThreadMessage[];
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readId(fields: Fields, key: string) {
  const value = fields[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > SLACK_LIMITS.id) return null;
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

function readText(fields: Fields, key: string, limit: number) {
  const value = fields[key];
  return typeof value === 'string' ? value.slice(0, limit) : null;
}

function parseThreadMessage(value: unknown): SlackThreadMessage | null {
  if (!isFields(value)) return null;
  const ts = readId(value, 'ts');
  const userId = readId(value, 'userId');
  const userName = readText(value, 'userName', SLACK_LIMITS.userName);
  const text = readText(value, 'text', SLACK_LIMITS.text);
  if (!ts || !userId || userName === null || text === null) return null;
  return { ts, userId, userName, text, bot: value.bot === true };
}

function parseThread(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-SLACK_LIMITS.threadMessages)
    .map(parseThreadMessage)
    .filter((message): message is SlackThreadMessage => message !== null);
}

function readPermalink(fields: Fields) {
  const value = readText(fields, 'permalink', SLACK_LIMITS.permalink);
  return value?.startsWith('https://') ? value : null;
}

export function parseSlackMention(value: unknown): SlackMention | null {
  if (!isFields(value)) return null;
  const eventId = readId(value, 'eventId');
  const teamId = readId(value, 'teamId');
  const channelId = readId(value, 'channelId');
  const threadTs = readId(value, 'threadTs');
  const messageTs = readId(value, 'messageTs');
  const userId = readId(value, 'userId');
  const userName = readText(value, 'userName', SLACK_LIMITS.userName);
  const text = readText(value, 'text', SLACK_LIMITS.text);
  if (!eventId || !teamId || !channelId || !threadTs || !messageTs || !userId) return null;
  if (userName === null || text === null) return null;
  return {
    eventId,
    teamId,
    channelId,
    threadTs,
    messageTs,
    userId,
    userName,
    text,
    permalink: readPermalink(value),
    thread: parseThread(value.thread),
  };
}

export function resolveSlackMentionThread(mention: SlackMention): SlackThreadRef {
  return { teamId: mention.teamId, channelId: mention.channelId, threadTs: mention.threadTs };
}
