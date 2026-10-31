import { encodeText, isSameSecret, serializeHex } from '../remote/bytes.ts';
import { SLACK_BLOCK_LIMITS } from './blocks.ts';
import { SLACK_LIMITS } from './contract.ts';

export const SLACK_RELAY_PATHS = {
  connect: '/slack/connect',
  connectCallback: '/slack/connect/callback',
  installCallback: '/slack/install/callback',
  events: '/slack/events',
  linkedPage: '/slack/linked',
  links: '/__remote/slack/links',
  unlink: '/__remote/slack/unlink',
  post: '/__remote/slack/post',
  session: '/__remote/slack/session',
  stream: '/__remote/slack/stream',
} as const;

export const SLACK_FORWARD_HEADERS = {
  signature: 'x-shinsa-slack-signature',
  timestamp: 'x-shinsa-slack-timestamp',
} as const;

export const SLACK_FORWARD_WINDOW_MS = 5 * 60_000;

export const SLACK_RELAY_MESSAGE_LIMITS = {
  text: 40_000,
  blocks: SLACK_BLOCK_LIMITS.blocks,
  chunks: 60,
} as const;

export const SLACK_SESSION_STATUSES = ['processing', 'suspended', 'active', 'closed'] as const;

export type SlackSessionStatus = (typeof SLACK_SESSION_STATUSES)[number];

export interface SlackRelayPost {
  teamId: string;
  channelId: string;
  threadTs: string;
  replaceTs: string | null;
  message: { text: string; blocks: unknown[] };
}

export interface SlackRelayPosted {
  ts: string;
}

export interface SlackRelaySession {
  teamId: string;
  channelId: string;
  threadTs: string;
  status: SlackSessionStatus;
}

export interface SlackRelaySessionSet {
  applied: boolean;
}

export interface SlackRelayStream {
  teamId: string;
  channelId: string;
  threadTs: string;
  recipientUserId: string;
  ts: string | null;
  done: boolean;
  chunks: unknown[];
}

export interface SlackLink {
  teamId: string;
  teamName: string;
  userId: string;
  userName: string;
  linkedAt: number;
}

export interface SlackLinks {
  links: SlackLink[];
}

export interface SlackSnapshot {
  remote: boolean;
  connectUrl: string | null;
  links: SlackLink[];
  problem: string | null;
}

export function resolveSlackConnectUrl(origin: string, instanceId: string) {
  return `${origin}${SLACK_RELAY_PATHS.connect}?instance=${encodeURIComponent(instanceId)}`;
}

export function resolveSlackTaskUrl(origin: string, taskId: string) {
  return `${origin}/tasks/${encodeURIComponent(taskId)}`;
}

const SIGNATURE_VERSION = 'v1';

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function signForward(connectKey: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encodeText(`slack:${connectKey}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payload = encodeText(`${SIGNATURE_VERSION}:${timestamp}:${body}`);
  return `${SIGNATURE_VERSION}=${serializeHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, payload)))}`;
}

export function createSlackForwardSignature(connectKey: string, timestamp: number, body: string) {
  return signForward(connectKey, String(timestamp), body);
}

export async function verifySlackForwardSignature(
  connectKey: string,
  headers: { signature: string | null; timestamp: string | null },
  body: string,
  now: number
) {
  if (!headers.signature || !headers.timestamp || !/^\d{1,16}$/.test(headers.timestamp)) return false;
  if (Math.abs(now - Number(headers.timestamp)) > SLACK_FORWARD_WINDOW_MS) return false;
  return isSameSecret(await signForward(connectKey, headers.timestamp, body), headers.signature);
}

function readId(fields: Fields, key: string) {
  const value = fields[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > SLACK_LIMITS.id) return null;
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

function readMessage(value: unknown): SlackRelayPost['message'] | null {
  if (!isFields(value)) return null;
  const { text, blocks } = value;
  if (typeof text !== 'string' || text.length === 0 || text.length > SLACK_RELAY_MESSAGE_LIMITS.text)
    return null;
  if (!Array.isArray(blocks) || blocks.length > SLACK_RELAY_MESSAGE_LIMITS.blocks) return null;
  return blocks.every(isFields) ? { text, blocks } : null;
}

export function parseSlackRelayPost(value: unknown): SlackRelayPost | null {
  if (!isFields(value)) return null;
  const teamId = readId(value, 'teamId');
  const channelId = readId(value, 'channelId');
  const threadTs = readId(value, 'threadTs');
  const replaceTs =
    value.replaceTs === null || value.replaceTs === undefined ? null : readId(value, 'replaceTs');
  const message = readMessage(value.message);
  if (!teamId || !channelId || !threadTs || !message) return null;
  if (replaceTs === null && value.replaceTs !== null && value.replaceTs !== undefined) return null;
  return { teamId, channelId, threadTs, replaceTs, message };
}

export interface SlackNames {
  users: ReadonlyMap<string, string>;
  botUserId: string | null;
}

export function resolveSlackReadableText(text: string, names: SlackNames) {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_match, id: string) => {
      if (id === names.botUserId) return '';
      return `@${names.users.get(id) ?? id}`;
    })
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, (_match, name: string) => `#${name}`)
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, (_match, name: string) => `@${name}`)
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]*)>/g, (_match, name: string) => name)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_match, url: string, label: string) => `${label} (${url})`)
    .replace(/<(https?:\/\/[^>]+)>/g, (_match, url: string) => url)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function listSlackMentionedUsers(text: string) {
  return [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1] as string))];
}

export function resolveSlackLinkedPath(result: { team: string } | { error: string }) {
  const params = new URLSearchParams('team' in result ? { team: result.team } : { error: result.error });
  return `${SLACK_RELAY_PATHS.linkedPage}?${params.toString()}`;
}

function readThread(value: Fields) {
  const teamId = readId(value, 'teamId');
  const channelId = readId(value, 'channelId');
  const threadTs = readId(value, 'threadTs');
  return teamId && channelId && threadTs ? { teamId, channelId, threadTs } : null;
}

function isSessionStatus(value: unknown): value is SlackSessionStatus {
  return SLACK_SESSION_STATUSES.some((status) => status === value);
}

export function parseSlackRelaySession(value: unknown): SlackRelaySession | null {
  if (!isFields(value)) return null;
  const thread = readThread(value);
  if (!thread || !isSessionStatus(value.status)) return null;
  return { ...thread, status: value.status };
}

export function parseSlackRelayStream(value: unknown): SlackRelayStream | null {
  if (!isFields(value)) return null;
  const thread = readThread(value);
  const recipientUserId = readId(value, 'recipientUserId');
  const ts = value.ts === null ? null : readId(value, 'ts');
  const { chunks } = value;
  if (!thread || !recipientUserId || (ts === null && value.ts !== null)) return null;
  if (typeof value.done !== 'boolean' || (ts === null && value.done)) return null;
  if (!Array.isArray(chunks) || chunks.length > SLACK_RELAY_MESSAGE_LIMITS.chunks || !chunks.every(isFields))
    return null;
  return { ...thread, recipientUserId, ts, done: value.done, chunks };
}
