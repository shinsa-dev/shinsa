import { Effect, Option, Schema } from 'effect';
import { SLACK_BLOCK_LIMITS } from './blocks.ts';
import { SLACK_LIMITS } from './contract.ts';

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
} as const;

export const SLACK_RELAY_MESSAGE_LIMITS = {
  text: 40_000,
  blocks: SLACK_BLOCK_LIMITS.blocks,
} as const;

export const SLACK_SESSION_STATUSES = ['processing', 'suspended', 'active', 'closed'] as const;

const SlackId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(SLACK_LIMITS.id),
  Schema.isPattern(/^[A-Za-z0-9._-]+$/)
);

const SlackReactionName = Schema.String.check(Schema.isPattern(/^[a-z0-9_+-]{1,64}$/));

const withNullDefault = <S extends Schema.Top>(schema: S) =>
  Schema.NullOr(schema).pipe(Schema.withDecodingDefault(Effect.succeed(null)));

const SlackThread = Schema.Struct({ teamId: SlackId, channelId: SlackId, threadTs: SlackId });

export const SlackRelayPost = Schema.Struct({
  ...SlackThread.fields,
  replaceTs: withNullDefault(SlackId),
  message: Schema.Struct({
    text: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(SLACK_RELAY_MESSAGE_LIMITS.text)),
    blocks: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).check(
      Schema.isMaxLength(SLACK_RELAY_MESSAGE_LIMITS.blocks)
    ),
  }),
});

export type SlackRelayPost = typeof SlackRelayPost.Type;

export const SlackRelayPosted = Schema.Struct({ ts: Schema.String });

export type SlackRelayPosted = typeof SlackRelayPosted.Type;

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
});

export type SlackLink = typeof SlackLink.Type;

export const SlackLinks = Schema.Struct({ links: Schema.Array(SlackLink) });

export type SlackLinks = typeof SlackLinks.Type;

export interface SlackSnapshot {
  remote: boolean;
  connectUrl: string | null;
  links: readonly SlackLink[];
  problem: string | null;
}

export function resolveSlackConnectUrl(origin: string, instanceId: string) {
  return `${origin}${SLACK_RELAY_PATHS.connect}?instance=${encodeURIComponent(instanceId)}`;
}

export function resolveSlackTaskUrl(origin: string, taskId: string) {
  return `${origin}/tasks/${encodeURIComponent(taskId)}`;
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
