import { Effect, Option, Schema } from 'effect';
import { NullByDefault } from '../domain/salvage.ts';
import { RemoteUserId } from '../remote/contract.ts';
import type { ShinsaState } from '../state/index.ts';
import { SLACK_BLOCK_LIMITS } from './blocks.ts';
import { SlackId } from './schema.ts';

export const SLACK_RELAY_PATHS = {
  connect: '/slack/connect',
  connectCallback: '/slack/connect/callback',
  installCallback: '/slack/install/callback',
  events: '/slack/events',
  interactions: '/slack/interactions',
  linkedPage: '/slack/linked',
  links: '/__remote/slack/links',
  unlink: '/__remote/slack/unlink',
  post: '/__remote/slack/post',
  session: '/__remote/slack/session',
  react: '/__remote/slack/react',
  directory: '/__remote/slack/directory',
  notify: '/__remote/slack/notify',
  channels: '/__remote/slack/channels',
  watches: '/__remote/slack/watches',
} as const;

export const SLACK_RELAY_MESSAGE_LIMITS = {
  text: 40_000,
  blocks: SLACK_BLOCK_LIMITS.blocks,
} as const;

export const SLACK_SESSION_STATUSES = ['processing', 'suspended', 'active', 'closed'] as const;

const SlackReactionName = Schema.String.check(Schema.isPattern(/^[a-z0-9_+-]{1,64}$/));

const withNullDefault = <S extends Schema.Top>(schema: S) =>
  Schema.NullOr(schema).pipe(Schema.withDecodingDefault(Effect.succeed(null)));

const SlackThread = Schema.Struct({ teamId: SlackId, channelId: SlackId, threadTs: SlackId });

const SlackRelayMessage = Schema.Struct({
  text: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(SLACK_RELAY_MESSAGE_LIMITS.text)),
  blocks: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).check(
    Schema.isMaxLength(SLACK_RELAY_MESSAGE_LIMITS.blocks)
  ),
});

export const SlackRelayPost = Schema.Struct({
  ...SlackThread.fields,
  replaceTs: withNullDefault(SlackId),
  message: SlackRelayMessage,
});

export type SlackRelayPost = typeof SlackRelayPost.Type;

export const SlackRelayPosted = Schema.Struct({ ts: Schema.String });

export type SlackRelayPosted = typeof SlackRelayPosted.Type;

const SlackRelayMessageRef = Schema.Struct({ channelId: SlackId, ts: SlackId });

export const SLACK_CONTACT_KINDS = ['slack_channel', 'slack_person'] as const;

export const SlackRelayNotify = Schema.Struct({
  teamId: SlackId,
  kind: Schema.Literals(SLACK_CONTACT_KINDS),
  id: SlackId,
  replace: withNullDefault(SlackRelayMessageRef),
  reply: withNullDefault(Schema.Struct({ channelId: SlackId, threadTs: SlackId })),
  message: SlackRelayMessage,
});

export type SlackRelayNotify = typeof SlackRelayNotify.Type;

export const SlackRelayNotified = SlackRelayMessageRef;

export type SlackRelayNotified = typeof SlackRelayNotified.Type;

export const SlackDirectoryQuery = Schema.Struct({ teamId: SlackId });

export type SlackDirectoryQuery = typeof SlackDirectoryQuery.Type;

export const SlackDirectoryEntry = Schema.Struct({
  id: SlackId,
  name: Schema.String,
  image: Schema.optionalKey(Schema.String),
});

export type SlackDirectoryEntry = typeof SlackDirectoryEntry.Type;

export const SlackDirectory = Schema.Struct({
  teamId: SlackId,
  channels: Schema.Array(SlackDirectoryEntry),
  people: Schema.Array(SlackDirectoryEntry),
});

export type SlackDirectory = typeof SlackDirectory.Type;

export interface SlackDirectoryView extends SlackDirectory {
  problem: string | null;
}

export const SlackSessionStatus = Schema.Literals(SLACK_SESSION_STATUSES);

export type SlackSessionStatus = typeof SlackSessionStatus.Type;

export const SlackRelaySession = Schema.Struct({ ...SlackThread.fields, status: SlackSessionStatus });

export type SlackRelaySession = typeof SlackRelaySession.Type;

export const SlackRelaySessionSet = Schema.Struct({ applied: Schema.Boolean });

export type SlackRelaySessionSet = typeof SlackRelaySessionSet.Type;

export const SlackRelayReaction = Schema.Struct({
  ...SlackThread.fields,
  messageTs: SlackId,
  add: withNullDefault(SlackReactionName),
  remove: withNullDefault(SlackReactionName),
}).check(Schema.makeFilter((reaction) => reaction.add !== null || reaction.remove !== null));

export type SlackRelayReaction = typeof SlackRelayReaction.Type;

export const SlackRelayReacted = Schema.Struct({ applied: Schema.Boolean });

export type SlackRelayReacted = typeof SlackRelayReacted.Type;

export const SlackLink = Schema.Struct({
  teamId: Schema.String,
  teamName: Schema.String,
  userId: Schema.String,
  userName: Schema.String,
  linkedAt: Schema.Number,
  accountId: NullByDefault(RemoteUserId),
});

export type SlackLink = typeof SlackLink.Type;

export const SlackLinks = Schema.Struct({ links: Schema.Array(SlackLink) });

export type SlackLinks = typeof SlackLinks.Type;

export interface SlackLinkUse extends SlackLink {
  lastUsedAt?: number | null;
}

export interface SlackSnapshot {
  remote: boolean;
  connectUrl: string | null;
  links: readonly SlackLinkUse[];
  othersLinked?: number;
  problem: string | null;
}

export function resolveSlackLastUsedAt(state: ShinsaState, link: Pick<SlackLink, 'teamId' | 'userId'>) {
  let lastUsedAt: number | null = null;
  for (const task of Object.values(state.tasks)) {
    if (task.scheduleId || task.slack?.teamId !== link.teamId || task.slack.userId !== link.userId) continue;
    lastUsedAt = Math.max(lastUsedAt ?? task.createdAt, task.createdAt);
  }
  return lastUsedAt;
}

export function resolveSlackConnectUrl(origin: string, instanceId: string) {
  return `${origin}${SLACK_RELAY_PATHS.connect}?instance=${encodeURIComponent(instanceId)}`;
}

export function resolveSlackTaskUrl(origin: string, taskId: string) {
  return `${origin}/tasks/${encodeURIComponent(taskId)}`;
}

export function resolveSlackEscalationUrl(
  origin: string,
  state: ShinsaState,
  taskId: string,
  instanceId: string
) {
  const projectId = state.tasks[taskId]?.projectId;
  const teamId = projectId ? state.projects[projectId]?.teamIds?.[0] : undefined;
  if (!teamId) return resolveSlackTaskUrl(origin, taskId);
  return `${origin}/teams/${[teamId, instanceId, taskId].map(encodeURIComponent).join('/')}`;
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

const decodeSlackRelayPost = Schema.decodeUnknownOption(SlackRelayPost);

const decodeSlackRelaySession = Schema.decodeUnknownOption(SlackRelaySession);

const decodeSlackRelayReaction = Schema.decodeUnknownOption(SlackRelayReaction);

export function parseSlackRelayPost(value: unknown) {
  return Option.getOrNull(decodeSlackRelayPost(value));
}

export function parseSlackRelaySession(value: unknown) {
  return Option.getOrNull(decodeSlackRelaySession(value));
}

export function parseSlackRelayReaction(value: unknown) {
  return Option.getOrNull(decodeSlackRelayReaction(value));
}
