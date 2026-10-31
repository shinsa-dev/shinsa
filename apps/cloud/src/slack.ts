import {
  createSlackForwardSignature,
  isSameSecret,
  listSlackAnsweredBlocks,
  listSlackMentionedUsers,
  parseSlackAnswerReply,
  parseSlackAnswerValue,
  parseSlackRelayPost,
  parseSlackRelayReaction,
  parseSlackRelaySession,
  resolveSlackReadableText,
  resolveTunnelHost,
  SLACK_ANSWER_ACTION,
  SLACK_BLOCKS_REFUSED,
  SLACK_ENGINE_EVENTS_PATH,
  SLACK_ENGINE_INTERACTIONS_PATH,
  SLACK_FORWARD_HEADERS,
  SLACK_LIMITS,
  SLACK_RELAY_PATHS,
  type SlackAnswer,
  type SlackLinks,
  type SlackMention,
  type SlackMessage,
  type SlackRelayPosted,
  type SlackRelayReacted,
  type SlackRelaySessionSet,
  type SlackThreadMessage,
  serializeSlackAnsweredView,
  serializeSlackLinkPrompt,
  serializeSlackOffline,
} from '@shinsa/core';
import { createSlackSignature, decryptToken } from './crypto.ts';
import type { InstanceRow, SlackThreadKey, SlackWorkspaceRow } from './database.ts';
import { TUNNEL_OFFLINE_STATUSES } from './hooks.ts';
import { CloudError, readJsonFields, respondError, respondJson } from './http.ts';
import { findMachine, isInstanceOnline } from './instances.ts';
import { recordFailure } from './log.ts';
import { readSlackText, requestSlack, requestSlackUserName, SlackApiError } from './slack-api.ts';
import type { CloudWorld } from './world.ts';

export const SLACK_EVENT_BODY_LIMIT_BYTES = 1024 * 1024;

const SLACK_POST_BODY_LIMIT_BYTES = 128 * 1024;

const SLACK_SIGNATURE_WINDOW_SECONDS = 5 * 60;

const SLACK_NAMED_USERS_LIMIT = 30;

type Fields = Record<string, unknown>;

interface MentionEvent {
  eventId: string;
  teamId: string;
  channelId: string;
  ts: string;
  threadTs: string;
  userId: string;
  text: string;
}

interface ThreadEntry {
  ts: string;
  userId: string;
  text: string;
  botName: string | null;
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(fields: Fields, key: string) {
  const value = fields[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

async function assertSlackSignature(request: Request, body: string, world: CloudWorld) {
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';
  const signature = request.headers.get('x-slack-signature') ?? '';
  const seconds = Number(timestamp);
  const fresh =
    /^\d{1,12}$/.test(timestamp) && Math.abs(world.now() / 1000 - seconds) <= SLACK_SIGNATURE_WINDOW_SECONDS;
  if (!fresh || !world.config.slackSigningSecret)
    throw new CloudError('signature_invalid', 'The Slack signature does not match.', 401);
  const expected = await createSlackSignature(world.config.slackSigningSecret, timestamp, body);
  if (!isSameSecret(expected, signature))
    throw new CloudError('signature_invalid', 'The Slack signature does not match.', 401);
}

function readMentionEvent(envelope: Fields): MentionEvent | null {
  const event = isFields(envelope.event) ? envelope.event : {};
  if (event.type !== 'app_mention' || event.bot_id !== undefined || event.subtype !== undefined) return null;
  const eventId = readString(envelope, 'event_id');
  const teamId = readString(envelope, 'team_id');
  const channelId = readString(event, 'channel');
  const ts = readString(event, 'ts');
  const userId = readString(event, 'user');
  if (!eventId || !teamId || !channelId || !ts || !userId) return null;
  return {
    eventId,
    teamId,
    channelId,
    ts,
    threadTs: readString(event, 'thread_ts') ?? ts,
    userId,
    text: typeof event.text === 'string' ? event.text : '',
  };
}

function isUninstallEvent(envelope: Fields) {
  const event = isFields(envelope.event) ? envelope.event : {};
  if (event.type === 'app_uninstalled') return true;
  const tokens = isFields(event.tokens) ? event.tokens : {};
  return event.type === 'tokens_revoked' && Array.isArray(tokens.bot) && tokens.bot.length > 0;
}

export async function respondSlackEvents(request: Request, world: CloudWorld) {
  const body = await request.text();
  if (body.length > SLACK_EVENT_BODY_LIMIT_BYTES)
    throw new CloudError('body_too_large', 'The Slack event is over 1 MB.', 413);
  await assertSlackSignature(request, body, world);
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    throw new CloudError('body_invalid', 'The Slack event is not JSON.', 400);
  }
  if (!isFields(envelope)) throw new CloudError('body_invalid', 'The Slack event is not JSON.', 400);
  if (envelope.type === 'url_verification') return respondJson({ challenge: envelope.challenge });
  const eventId = readString(envelope, 'event_id');
  if (envelope.type !== 'event_callback' || !eventId) return respondJson({ ok: true });
  if (!(await world.store.recordSlackEvent(eventId, world.now()))) return respondJson({ ok: true });
  const teamId = readString(envelope, 'team_id');
  if (teamId && isUninstallEvent(envelope)) {
    await world.store.removeSlackWorkspace(teamId);
    return respondJson({ ok: true });
  }
  const mention = readMentionEvent(envelope);
  if (mention) world.defer(recordMentionFailure(handleMention(mention, world), mention));
  return respondJson({ ok: true });
}

async function recordMentionFailure(work: Promise<void>, mention: MentionEvent) {
  try {
    await work;
  } catch (error) {
    recordFailure('[Cloud] A Slack mention could not be forwarded', {
      error,
      teamId: mention.teamId,
      eventId: mention.eventId,
    });
  }
}

async function postInThread(world: CloudWorld, token: string, mention: MentionEvent, message: SlackMessage) {
  await requestSlack(world, 'chat.postMessage', {
    token,
    json: {
      channel: mention.channelId,
      thread_ts: mention.threadTs,
      text: message.text,
      blocks: message.blocks,
      unfurl_links: false,
      unfurl_media: false,
    },
  });
}

async function handleMention(mention: MentionEvent, world: CloudWorld) {
  const workspace = await world.store.selectSlackWorkspace(mention.teamId);
  if (!workspace) return;
  const token = await decryptToken(world.config.slackTokenKey, workspace.bot_token);
  const link = await world.store.selectSlackLink(mention.teamId, mention.userId);
  if (!link) {
    const prompt = serializeSlackLinkPrompt(`${world.config.origin}${SLACK_RELAY_PATHS.connect}`);
    await requestSlack(world, 'chat.postEphemeral', {
      token,
      json: {
        channel: mention.channelId,
        user: mention.userId,
        thread_ts: mention.threadTs,
        text: prompt.text,
        blocks: prompt.blocks,
      },
    });
    return;
  }
  const instance = await world.store.selectInstance(link.instance_id);
  if (!instance || !isInstanceOnline(instance, world.now())) {
    await postInThread(world, token, mention, serializeSlackOffline(instance?.name ?? 'Your machine'));
    return;
  }
  const forwarded = await resolveForwardedMention(mention, workspace, token, world);
  await world.store.recordSlackThread(mention, instance.id, world.now());
  if (!(await forwardMention(forwarded, instance, world)))
    await postInThread(world, token, mention, serializeSlackOffline(instance.name));
}

function readThreadEntry(value: unknown): ThreadEntry | null {
  if (!isFields(value)) return null;
  const ts = readString(value, 'ts');
  const botProfile = isFields(value.bot_profile) ? value.bot_profile : {};
  const botName =
    value.bot_id === undefined
      ? null
      : (readString(botProfile, 'name') ?? readString(value, 'username') ?? 'Bot');
  const userId = readString(value, 'user') ?? readString(value, 'bot_id');
  if (!ts || !userId) return null;
  return { ts, userId, text: typeof value.text === 'string' ? value.text : '', botName };
}

async function listThreadEntries(
  mention: MentionEvent,
  token: string,
  world: CloudWorld
): Promise<ThreadEntry[]> {
  const own: ThreadEntry = { ts: mention.ts, userId: mention.userId, text: mention.text, botName: null };
  if (mention.threadTs === mention.ts) return [own];
  try {
    const replies = await requestSlack(world, 'conversations.replies', {
      token,
      form: { channel: mention.channelId, ts: mention.threadTs, limit: String(SLACK_LIMITS.threadMessages) },
    });
    const messages = Array.isArray(replies.messages) ? replies.messages : [];
    const entries = messages.map(readThreadEntry).filter((entry): entry is ThreadEntry => entry !== null);
    return entries.some((entry) => entry.ts === mention.ts) ? entries : [...entries, own];
  } catch (error) {
    recordFailure('[Cloud] A Slack thread could not be read', { error, teamId: mention.teamId });
    return [own];
  }
}

async function resolveUserNames(entries: ThreadEntry[], token: string, world: CloudWorld) {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.botName === null) ids.add(entry.userId);
    for (const id of listSlackMentionedUsers(entry.text)) ids.add(id);
  }
  const names = new Map<string, string>();
  for (const id of [...ids].slice(0, SLACK_NAMED_USERS_LIMIT)) {
    const name = await requestSlackUserName(world, token, id);
    if (name) names.set(id, name);
  }
  return names;
}

async function requestPermalink(mention: MentionEvent, token: string, world: CloudWorld) {
  try {
    const answer = await requestSlack(world, 'chat.getPermalink', {
      token,
      form: { channel: mention.channelId, message_ts: mention.ts },
    });
    return readSlackText(answer, 'permalink');
  } catch {
    return null;
  }
}

async function resolveForwardedMention(
  mention: MentionEvent,
  workspace: SlackWorkspaceRow,
  token: string,
  world: CloudWorld
): Promise<SlackMention> {
  const entries = (await listThreadEntries(mention, token, world)).slice(-SLACK_LIMITS.threadMessages);
  const users = await resolveUserNames(entries, token, world);
  const names = { users, botUserId: workspace.bot_user_id };
  const readable = (text: string) => resolveSlackReadableText(text, names).slice(0, SLACK_LIMITS.text);
  const nameOf = (id: string) => (users.get(id) ?? id).slice(0, SLACK_LIMITS.userName);
  const thread: SlackThreadMessage[] = entries.map((entry) => ({
    ts: entry.ts,
    userId: entry.userId,
    userName: (entry.botName ?? nameOf(entry.userId)).slice(0, SLACK_LIMITS.userName),
    text: readable(entry.text),
    bot: entry.botName !== null || entry.userId === workspace.bot_user_id,
  }));
  return {
    eventId: mention.eventId,
    teamId: mention.teamId,
    channelId: mention.channelId,
    threadTs: mention.threadTs,
    messageTs: mention.ts,
    userId: mention.userId,
    userName: nameOf(mention.userId),
    text: readable(mention.text),
    permalink: await requestPermalink(mention, token, world),
    thread,
  };
}

async function requestMachine(instance: InstanceRow, path: string, payload: unknown, world: CloudWorld) {
  const body = JSON.stringify(payload);
  const timestamp = world.now();
  const signature = await createSlackForwardSignature(instance.connect_key, timestamp, body);
  try {
    return await world.fetch(`https://${resolveTunnelHost(instance.id)}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SLACK_FORWARD_HEADERS.signature]: signature,
        [SLACK_FORWARD_HEADERS.timestamp]: String(timestamp),
      },
      body,
      redirect: 'manual',
    });
  } catch {
    return null;
  }
}

async function forwardMention(mention: SlackMention, instance: InstanceRow, world: CloudWorld) {
  const answer = await requestMachine(instance, SLACK_ENGINE_EVENTS_PATH, mention, world);
  if (!answer || TUNNEL_OFFLINE_STATUSES.has(answer.status)) return false;
  if (!answer.ok)
    recordFailure('[Cloud] A machine refused a Slack mention', {
      instanceId: instance.id,
      status: answer.status,
    });
  return true;
}

export async function respondSlackLinks(request: Request, world: CloudWorld) {
  const instance = await findMachine(request, world);
  const rows = await world.store.listInstanceSlackLinks(instance.id);
  const answer: SlackLinks = {
    links: rows.map((row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      userId: row.slack_user_id,
      userName: row.slack_user_name,
      linkedAt: row.linked_at,
    })),
  };
  return respondJson(answer);
}

export async function respondSlackUnlink(request: Request, world: CloudWorld) {
  const instance = await findMachine(request, world);
  await world.store.removeInstanceSlackLinks(instance.id);
  return respondJson({ ok: true });
}

const REFUSED_BLOCK_CODES = new Set(['invalid_blocks', 'invalid_blocks_format']);

async function requestSlackPost(world: CloudWorld, method: string, token: string, json: Fields) {
  try {
    return await requestSlack(world, method, { token, json });
  } catch (error) {
    const code = error instanceof SlackApiError ? error.code : 'failed';
    if (REFUSED_BLOCK_CODES.has(code))
      throw new CloudError(SLACK_BLOCKS_REFUSED, `Slack did not take the blocks in the post (${code}).`, 422);
    throw new CloudError('slack_failed', `Slack did not take the post (${code}).`, 502);
  }
}

async function findThreadToken(
  instance: InstanceRow,
  thread: SlackThreadKey,
  ownTs: string | null,
  world: CloudWorld
) {
  if (!(await world.store.hasSlackThread(thread, instance.id)))
    throw new CloudError('thread_not_forwarded', 'This machine was never sent that Slack thread.', 403);
  if (ownTs && !(await world.store.hasSlackPost(thread.teamId, thread.channelId, ownTs, instance.id)))
    throw new CloudError('post_not_yours', 'This machine did not post that Slack message.', 403);
  const workspace = await world.store.selectSlackWorkspace(thread.teamId);
  if (!workspace)
    throw new CloudError('slack_not_installed', 'Shinsa is no longer in that Slack workspace.', 410);
  return decryptToken(world.config.slackTokenKey, workspace.bot_token);
}

async function recordPosted(
  world: CloudWorld,
  posted: Fields,
  thread: SlackThreadKey,
  instance: InstanceRow
) {
  const ts = readSlackText(posted, 'ts');
  if (!ts) throw new CloudError('slack_failed', 'Slack did not say where the post went.', 502);
  await world.store.recordSlackPost(thread.teamId, thread.channelId, ts, instance.id);
  const answer: SlackRelayPosted = { ts };
  return respondJson(answer);
}

export async function respondSlackPost(request: Request, world: CloudWorld) {
  const instance = await findMachine(request, world);
  const post = parseSlackRelayPost(await readJsonFields(request, SLACK_POST_BODY_LIMIT_BYTES));
  if (!post) throw new CloudError('body_invalid', 'The Slack post is not one this relay sends.', 400);
  const token = await findThreadToken(instance, post, post.replaceTs, world);
  const content = { channel: post.channelId, text: post.message.text, blocks: post.message.blocks };
  if (post.replaceTs) {
    await requestSlackPost(world, 'chat.update', token, { ...content, ts: post.replaceTs });
    const answer: SlackRelayPosted = { ts: post.replaceTs };
    return respondJson(answer);
  }
  const posted = await requestSlackPost(world, 'chat.postMessage', token, {
    ...content,
    thread_ts: post.threadTs,
    unfurl_links: false,
    unfurl_media: false,
  });
  return recordPosted(world, posted, post, instance);
}

const STATUS_UNAVAILABLE_CODES = new Set(['not_authorized', 'feature_disabled']);

export async function respondSlackSession(request: Request, world: CloudWorld) {
  const instance = await findMachine(request, world);
  const session = parseSlackRelaySession(await readJsonFields(request));
  if (!session) throw new CloudError('body_invalid', 'The Slack status is not one this relay sends.', 400);
  const token = await findThreadToken(instance, session, null, world);
  try {
    await requestSlack(world, 'agents.sessions.setStatus', {
      token,
      json: { channel_id: session.channelId, thread_ts: session.threadTs, status: session.status },
    });
  } catch (error) {
    if (error instanceof SlackApiError && STATUS_UNAVAILABLE_CODES.has(error.code)) {
      return respondJson({ applied: false } satisfies SlackRelaySessionSet);
    }
    recordFailure('[Cloud] Slack did not take a thread status', { error, teamId: session.teamId });
    const code = error instanceof SlackApiError ? error.code : 'failed';
    return respondError(
      new CloudError('slack_failed', `Slack did not take the thread status (${code}).`, 502)
    );
  }
  return respondJson({ applied: true } satisfies SlackRelaySessionSet);
}

const SETTLED_REACTION_CODES = new Set(['no_reaction', 'already_reacted']);

async function requestReaction(
  world: CloudWorld,
  method: string,
  token: string,
  target: Fields,
  name: string | null
) {
  if (!name) return true;
  try {
    await requestSlack(world, method, { token, json: { ...target, name } });
    return true;
  } catch (error) {
    if (error instanceof SlackApiError && SETTLED_REACTION_CODES.has(error.code)) return true;
    recordFailure('[Cloud] Slack did not take a reaction', { error, method });
    return false;
  }
}

export async function respondSlackReaction(request: Request, world: CloudWorld) {
  const instance = await findMachine(request, world);
  const reaction = parseSlackRelayReaction(await readJsonFields(request));
  if (!reaction) throw new CloudError('body_invalid', 'The Slack reaction is not one this relay sends.', 400);
  const token = await findThreadToken(instance, reaction, null, world);
  const target = { channel: reaction.channelId, timestamp: reaction.messageTs };
  const removed = await requestReaction(world, 'reactions.remove', token, target, reaction.remove);
  const added = await requestReaction(world, 'reactions.add', token, target, reaction.add);
  const answer: SlackRelayReacted = { applied: removed && added };
  return respondJson(answer);
}

const RESPONSE_URL_ORIGIN = 'https://hooks.slack.com/';

interface AnswerClick {
  answer: SlackAnswer;
  responseUrl: string;
  message: { text: string; blocks: unknown[] };
}

function readAnswerClick(payload: Fields): AnswerClick | null {
  if (payload.type !== 'block_actions') return null;
  const team = isFields(payload.team) ? payload.team : {};
  const user = isFields(payload.user) ? payload.user : {};
  const channel = isFields(payload.channel) ? payload.channel : {};
  const message = isFields(payload.message) ? payload.message : {};
  const action = Array.isArray(payload.actions) && isFields(payload.actions[0]) ? payload.actions[0] : {};
  const actionId = readString(action, 'action_id');
  const value = parseSlackAnswerValue(readString(action, 'value') ?? '');
  const responseUrl = readString(payload, 'response_url');
  const teamId = readString(team, 'id');
  const userId = readString(user, 'id');
  const channelId = readString(channel, 'id');
  const messageTs = readString(message, 'ts');
  const interactionId = readString(payload, 'trigger_id') ?? readString(action, 'action_ts');
  if (
    !actionId?.startsWith(`${SLACK_ANSWER_ACTION}.`) ||
    !value ||
    !responseUrl?.startsWith(RESPONSE_URL_ORIGIN)
  )
    return null;
  if (!teamId || !userId || !channelId || !messageTs || !interactionId) return null;
  return {
    answer: {
      interactionId: interactionId.slice(0, SLACK_LIMITS.id),
      teamId,
      channelId,
      threadTs: readString(message, 'thread_ts') ?? messageTs,
      messageTs,
      userId,
      gateId: value.gateId,
      choice: value.choice,
    },
    responseUrl,
    message: {
      text: typeof message.text === 'string' ? message.text : '',
      blocks: Array.isArray(message.blocks) ? message.blocks : [],
    },
  };
}

export async function respondSlackInteractions(request: Request, world: CloudWorld) {
  const body = await request.text();
  if (body.length > SLACK_EVENT_BODY_LIMIT_BYTES)
    throw new CloudError('body_too_large', 'The Slack interaction is over 1 MB.', 413);
  await assertSlackSignature(request, body, world);
  let payload: unknown;
  try {
    payload = JSON.parse(new URLSearchParams(body).get('payload') ?? '');
  } catch {
    throw new CloudError('body_invalid', 'The Slack interaction is not JSON.', 400);
  }
  const click = isFields(payload) ? readAnswerClick(payload) : null;
  if (click) world.defer(recordAnswerFailure(handleAnswer(click, world), click));
  return new Response(null, { status: 200 });
}

async function recordAnswerFailure(work: Promise<void>, click: AnswerClick) {
  try {
    await work;
  } catch (error) {
    recordFailure('[Cloud] A Slack answer could not be passed on', { error, teamId: click.answer.teamId });
  }
}

async function respondInSlack(world: CloudWorld, click: AnswerClick, body: Fields) {
  await world.fetch(click.responseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function respondPrivately(world: CloudWorld, click: AnswerClick, text: string) {
  return respondInSlack(world, click, { response_type: 'ephemeral', replace_original: false, text });
}

async function handleAnswer(click: AnswerClick, world: CloudWorld) {
  const { answer } = click;
  const link = await world.store.selectSlackLink(answer.teamId, answer.userId);
  if (!link) {
    await respondPrivately(world, click, 'Connect Slack to your own Shinsa first, then answer it in Shinsa.');
    return;
  }
  if (
    !(await world.store.hasSlackPost(answer.teamId, answer.channelId, answer.messageTs, link.instance_id))
  ) {
    await respondPrivately(
      world,
      click,
      'This question was asked on someone else’s machine, so only they can answer it.'
    );
    return;
  }
  const instance = await world.store.selectInstance(link.instance_id);
  const reply = await requestAnswer(instance, answer, world);
  if (!reply) {
    await respondPrivately(
      world,
      click,
      `${instance?.name ?? 'Your machine'} is offline, so the answer was not sent. Try again once Shinsa runs there.`
    );
    return;
  }
  if (!reply.answered) {
    await respondPrivately(world, click, reply.reason);
    return;
  }
  await respondInSlack(world, click, {
    replace_original: true,
    text: click.message.text,
    blocks: listSlackAnsweredBlocks(
      click.message.blocks,
      serializeSlackAnsweredView(reply.choice, answer.userId)
    ),
  });
}

async function requestAnswer(instance: InstanceRow | null, answer: SlackAnswer, world: CloudWorld) {
  if (!instance || !isInstanceOnline(instance, world.now())) return null;
  const response = await requestMachine(instance, SLACK_ENGINE_INTERACTIONS_PATH, answer, world);
  if (!response?.ok) return null;
  try {
    return parseSlackAnswerReply(await response.json());
  } catch {
    return null;
  }
}
