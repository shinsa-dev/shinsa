import {
  listSlackAnsweredBlocks,
  listSlackMentionedUsers,
  parseSlackAnswerReply,
  parseSlackAnswerValue,
  resolveSlackReadableText,
  SLACK_ANSWER_ACTION,
  SLACK_ENGINE_EVENTS_PATH,
  SLACK_ENGINE_INTERACTIONS_PATH,
  SLACK_LIMITS,
  SLACK_RELAY_PATHS,
  type SlackAnswer,
  type SlackMention,
  type SlackMessage,
  type SlackThreadMessage,
  serializeSlackAnsweredView,
  serializeSlackLinkPrompt,
  serializeSlackOffline,
} from '@shinsa/core';
import { BodyInvalid } from '@shinsa/core/remote/errors';
import { Cause, Clock, Effect, Layer, Option, type Redacted, Schema } from 'effect';
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from 'effect/http';
import { CloudConfig } from '../config/config.ts';
import { deferWork } from '../http/worker.ts';
import { SlackApi } from '../integrations/slack.ts';
import {
  decodeJsonFields,
  readFields,
  readSignedBody,
  readString,
  readText,
  type SlackFields,
  toFields,
} from '../slack/requests.ts';
import { isTunnelDown, requestSignedMachine, selectWorkspaceToken } from '../slack/workspace.ts';
import { type Machine, Machines } from '../store/machines.ts';
import { SlackStore, type SlackWorkspace } from '../store/slack.ts';
import { isMachineOnline } from '../views/machines.ts';

const SLACK_NAMED_USERS_LIMIT = 30;

const RESPONSE_URL_ORIGIN = 'https://hooks.slack.com/';

const ok = () => HttpServerResponse.jsonUnsafe({ ok: true }, { headers: { 'cache-control': 'no-store' } });

interface MentionEvent {
  readonly eventId: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly ts: string;
  readonly threadTs: string;
  readonly userId: string;
  readonly text: string;
}

interface ThreadEntry {
  readonly ts: string;
  readonly userId: string;
  readonly text: string;
  readonly botName: string | null;
}

const Replies = Schema.Struct({ messages: Schema.optional(Schema.Array(Schema.Unknown)) });

const Permalink = Schema.Struct({ permalink: Schema.optional(Schema.String) });

function readMentionEvent(envelope: SlackFields): MentionEvent | null {
  const event = readFields(envelope, 'event');
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
    text: readText(event, 'text'),
  };
}

function isUninstallEvent(envelope: SlackFields) {
  const event = readFields(envelope, 'event');
  if (event.type === 'app_uninstalled') return true;
  const bot = readFields(event, 'tokens').bot;
  return event.type === 'tokens_revoked' && Array.isArray(bot) && bot.length > 0;
}

function readThreadEntry(value: unknown): ThreadEntry | null {
  const fields = Option.getOrNull(
    Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(value)
  );
  if (!fields) return null;
  const ts = readString(fields, 'ts');
  const userId = readString(fields, 'user') ?? readString(fields, 'bot_id');
  if (!ts || !userId) return null;
  const botName =
    fields.bot_id === undefined
      ? null
      : (readString(readFields(fields, 'bot_profile'), 'name') ?? readString(fields, 'username') ?? 'Bot');
  return { ts, userId, text: readText(fields, 'text'), botName };
}

const handleMention = Effect.fn('slackEvents.handleMention')(function* (mention: MentionEvent) {
  const config = yield* CloudConfig;
  const slack = yield* SlackApi;
  const store = yield* SlackStore;
  const machines = yield* Machines;
  const opened = yield* selectWorkspaceToken(mention.teamId);
  if (Option.isNone(opened)) return;
  const { workspace, token } = opened.value;

  const postInThread = (message: SlackMessage) =>
    slack.call(
      'chat.postMessage',
      {
        token,
        body: {
          json: {
            channel: mention.channelId,
            thread_ts: mention.threadTs,
            text: message.text,
            blocks: message.blocks,
            unfurl_links: false,
            unfurl_media: false,
          },
        },
      },
      Schema.Unknown
    );

  const link = yield* store.selectLink(mention.teamId, mention.userId);
  if (Option.isNone(link)) {
    const prompt = serializeSlackLinkPrompt(`${config.origin}${SLACK_RELAY_PATHS.connect}`);
    yield* slack.call(
      'chat.postEphemeral',
      {
        token,
        body: {
          json: {
            channel: mention.channelId,
            user: mention.userId,
            thread_ts: mention.threadTs,
            text: prompt.text,
            blocks: prompt.blocks,
          },
        },
      },
      Schema.Unknown
    );
    return;
  }
  const machine = yield* machines.select(link.value.instanceId);
  const now = yield* Clock.currentTimeMillis;
  if (Option.isNone(machine) || !isMachineOnline(machine.value, now)) {
    yield* postInThread(serializeSlackOffline(Option.isSome(machine) ? machine.value.name : 'Your machine'));
    return;
  }
  const forwarded = yield* resolveForwardedMention(mention, workspace, token);
  yield* store.recordThread(
    { teamId: mention.teamId, channelId: mention.channelId, threadTs: mention.threadTs },
    machine.value.id
  );
  if (!(yield* forwardMention(forwarded, machine.value)))
    yield* postInThread(serializeSlackOffline(machine.value.name));
});

const listThreadEntries = Effect.fn('slackEvents.listThreadEntries')(function* (
  mention: MentionEvent,
  token: Redacted.Redacted<string>
) {
  const slack = yield* SlackApi;
  const own: ThreadEntry = { ts: mention.ts, userId: mention.userId, text: mention.text, botName: null };
  if (mention.threadTs === mention.ts) return [own];
  return yield* slack
    .call(
      'conversations.replies',
      {
        token,
        body: {
          form: {
            channel: mention.channelId,
            ts: mention.threadTs,
            limit: String(SLACK_LIMITS.threadMessages),
          },
        },
      },
      Replies
    )
    .pipe(
      Effect.map((replies) => {
        const entries = (replies.messages ?? []).map(readThreadEntry).filter((entry) => entry !== null);
        return entries.some((entry) => entry.ts === mention.ts) ? entries : [...entries, own];
      }),
      Effect.catchTag('SlackCallFailed', (error) =>
        Effect.as(
          Effect.logError('[Cloud] A Slack thread could not be read').pipe(
            Effect.annotateLogs({ error, teamId: mention.teamId })
          ),
          [own]
        )
      )
    );
});

const resolveUserNames = Effect.fn('slackEvents.resolveUserNames')(function* (
  entries: ReadonlyArray<ThreadEntry>,
  token: Redacted.Redacted<string>
) {
  const slack = yield* SlackApi;
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.botName === null) ids.add(entry.userId);
    for (const id of listSlackMentionedUsers(entry.text)) ids.add(id);
  }
  const names = new Map<string, string>();
  for (const id of [...ids].slice(0, SLACK_NAMED_USERS_LIMIT)) {
    const name = yield* slack.selectUserName(token, id);
    if (Option.isSome(name)) names.set(id, name.value);
  }
  return names;
});

const resolveForwardedMention = Effect.fn('slackEvents.resolveForwardedMention')(function* (
  mention: MentionEvent,
  workspace: SlackWorkspace,
  token: Redacted.Redacted<string>
) {
  const slack = yield* SlackApi;
  const entries = (yield* listThreadEntries(mention, token)).slice(-SLACK_LIMITS.threadMessages);
  const users = yield* resolveUserNames(entries, token);
  const names = { users, botUserId: workspace.botUserId };
  const readable = (text: string) => resolveSlackReadableText(text, names).slice(0, SLACK_LIMITS.text);
  const nameOf = (id: string) => (users.get(id) ?? id).slice(0, SLACK_LIMITS.userName);
  const thread = entries.map(
    (entry): SlackThreadMessage => ({
      ts: entry.ts,
      userId: entry.userId,
      userName: (entry.botName ?? nameOf(entry.userId)).slice(0, SLACK_LIMITS.userName),
      text: readable(entry.text),
      bot: entry.botName !== null || entry.userId === workspace.botUserId,
    })
  );
  const permalink = yield* slack
    .call(
      'chat.getPermalink',
      { token, body: { form: { channel: mention.channelId, message_ts: mention.ts } } },
      Permalink
    )
    .pipe(
      Effect.map((answer) => answer.permalink || null),
      Effect.orElseSucceed(() => null)
    );
  return {
    eventId: mention.eventId,
    teamId: mention.teamId,
    channelId: mention.channelId,
    threadTs: mention.threadTs,
    messageTs: mention.ts,
    userId: mention.userId,
    userName: nameOf(mention.userId),
    text: readable(mention.text),
    permalink,
    thread,
  } satisfies SlackMention;
});

const forwardMention = Effect.fn('slackEvents.forwardMention')(function* (
  mention: SlackMention,
  machine: Machine
) {
  const answer = yield* Effect.option(requestSignedMachine(machine, SLACK_ENGINE_EVENTS_PATH, mention));
  if (Option.isNone(answer) || isTunnelDown(answer.value)) return false;
  if (!answer.value.ok)
    yield* Effect.logError('[Cloud] A machine refused a Slack mention').pipe(
      Effect.annotateLogs({ instanceId: machine.id, status: answer.value.status })
    );
  return true;
});

const respondEvents = Effect.gen(function* () {
  const store = yield* SlackStore;
  const body = yield* readSignedBody('event');
  const envelope = decodeJsonFields(body);
  if (Option.isNone(envelope)) return yield* new BodyInvalid({ message: 'The Slack event is not JSON.' });
  const fields = envelope.value;
  if (fields.type === 'url_verification')
    return HttpServerResponse.jsonUnsafe({ challenge: fields.challenge });
  const eventId = readString(fields, 'event_id');
  if (fields.type !== 'event_callback' || !eventId || !(yield* store.recordEvent(eventId))) return ok();
  const teamId = readString(fields, 'team_id');
  if (teamId && isUninstallEvent(fields)) {
    yield* store.removeWorkspace(teamId);
    return ok();
  }
  const mention = readMentionEvent(fields);
  if (mention)
    yield* deferWork(
      handleMention(mention).pipe(
        Effect.catchCause((cause) =>
          Effect.logError('[Cloud] A Slack mention could not be forwarded').pipe(
            Effect.annotateLogs({
              cause: Cause.pretty(cause),
              teamId: mention.teamId,
              eventId: mention.eventId,
            })
          )
        )
      )
    );
  return ok();
});

interface AnswerClick {
  readonly answer: SlackAnswer;
  readonly responseUrl: string;
  readonly message: { readonly text: string; readonly blocks: ReadonlyArray<unknown> };
}

function readAnswerClick(payload: SlackFields): AnswerClick | null {
  if (payload.type !== 'block_actions') return null;
  const message = readFields(payload, 'message');
  const actions = payload.actions;
  const action = (Array.isArray(actions) ? toFields(actions[0]) : null) ?? {};
  const actionId = readString(action, 'action_id');
  const value = parseSlackAnswerValue(readString(action, 'value') ?? '');
  const responseUrl = readString(payload, 'response_url');
  const teamId = readString(readFields(payload, 'team'), 'id');
  const userId = readString(readFields(payload, 'user'), 'id');
  const channelId = readString(readFields(payload, 'channel'), 'id');
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
    message: { text: readText(message, 'text'), blocks: Array.isArray(message.blocks) ? message.blocks : [] },
  };
}

const requestAnswer = Effect.fn('slackEvents.requestAnswer')(function* (
  machine: Option.Option<Machine>,
  answer: SlackAnswer
) {
  const now = yield* Clock.currentTimeMillis;
  if (Option.isNone(machine) || !isMachineOnline(machine.value, now)) return null;
  const response = yield* Effect.option(
    requestSignedMachine(machine.value, SLACK_ENGINE_INTERACTIONS_PATH, answer)
  );
  if (Option.isNone(response) || !response.value.ok) return null;
  const reply = yield* Effect.option(Effect.tryPromise(() => response.value.json()));
  return Option.match(reply, { onNone: () => null, onSome: parseSlackAnswerReply });
});

const handleAnswer = Effect.fn('slackEvents.handleAnswer')(function* (click: AnswerClick) {
  const store = yield* SlackStore;
  const machines = yield* Machines;
  const client = yield* HttpClient.HttpClient;
  const { answer } = click;
  const respondInSlack = (body: Readonly<Record<string, unknown>>) =>
    client.execute(HttpClientRequest.post(click.responseUrl).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
  const respondPrivately = (text: string) =>
    respondInSlack({ response_type: 'ephemeral', replace_original: false, text });
  const link = yield* store.selectLink(answer.teamId, answer.userId);
  if (Option.isNone(link))
    return yield* respondPrivately('Connect Slack to your own Shinsa first, then answer it in Shinsa.');
  const asked = { teamId: answer.teamId, channelId: answer.channelId, ts: answer.messageTs };
  if (!(yield* store.hasPost(asked, link.value.instanceId)))
    return yield* respondPrivately(
      'This question was asked on someone else’s machine, so only they can answer it.'
    );
  const machine = yield* machines.select(link.value.instanceId);
  const reply = yield* requestAnswer(machine, answer);
  if (!reply) {
    const name = Option.isSome(machine) ? machine.value.name : 'Your machine';
    return yield* respondPrivately(
      `${name} is offline, so the answer was not sent. Try again once Shinsa runs there.`
    );
  }
  if (!reply.answered) return yield* respondPrivately(reply.reason);
  return yield* respondInSlack({
    replace_original: true,
    text: click.message.text,
    blocks: listSlackAnsweredBlocks(
      [...click.message.blocks],
      serializeSlackAnsweredView(reply.choice, answer.userId)
    ),
  });
});

const respondInteractions = Effect.gen(function* () {
  const body = yield* readSignedBody('interaction');
  const payload = decodeJsonFields(new URLSearchParams(body).get('payload') ?? '');
  if (Option.isNone(payload))
    return yield* new BodyInvalid({ message: 'The Slack interaction is not JSON.' });
  const click = readAnswerClick(payload.value);
  if (click)
    yield* deferWork(
      handleAnswer(click).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.logError('[Cloud] A Slack answer could not be passed on').pipe(
            Effect.annotateLogs({ cause: Cause.pretty(cause), teamId: click.answer.teamId })
          )
        )
      )
    );
  return HttpServerResponse.empty({ status: 200 });
});

export const SlackEventRoutes = Layer.mergeAll(
  HttpRouter.add('POST', SLACK_RELAY_PATHS.events, respondEvents),
  HttpRouter.add('POST', SLACK_RELAY_PATHS.interactions, respondInteractions)
);
