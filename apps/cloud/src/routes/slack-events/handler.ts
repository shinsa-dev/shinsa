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
import { CloudConfig } from '../../config/service.ts';
import { isMachineOnline } from '../../domain/machines.ts';
import { TUNNEL_OFFLINE_STATUSES } from '../../http/forward.ts';
import { deferWork } from '../../http/worker.ts';
import { SlackApi } from '../../integrations/slack/service.ts';
import { readSignedBody } from '../../slack/signed-body.ts';
import { requestSignedMachine, selectWorkspaceToken } from '../../slack/workspace.ts';
import type { Machine } from '../../store/machines/schema.ts';
import { Machines } from '../../store/machines/service.ts';
import type { SlackWorkspace } from '../../store/slack/schema.ts';
import { SlackStore } from '../../store/slack/service.ts';
import {
  type AnswerClick,
  type BlockActions,
  BlockActions as BlockActionsSchema,
  EventEnvelope,
  InteractionForm,
  JsonObject,
  MentionEnvelope,
  type MentionEvent,
  Permalink,
  RESPONSE_URL_ORIGIN,
  Replies,
  SLACK_NAMED_USERS_LIMIT,
  type ThreadEntry,
  ThreadMessage,
  UninstallEvent,
} from './schema.ts';

export const SlackEventRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* CloudConfig;
    const slack = yield* SlackApi;
    const store = yield* SlackStore;
    const machines = yield* Machines;
    const client = yield* HttpClient.HttpClient;

    const decodeJson = Schema.decodeUnknownOption(JsonObject);
    const decodeEnvelope = Schema.decodeUnknownOption(EventEnvelope);
    const decodeUninstall = Schema.decodeUnknownOption(UninstallEvent);
    const decodeMention = Schema.decodeUnknownOption(MentionEnvelope);
    const decodeThreadMessage = Schema.decodeUnknownOption(ThreadMessage);
    const decodeForm = Schema.decodeUnknownOption(InteractionForm);
    const decodeBlockActions = Schema.decodeUnknownOption(BlockActionsSchema);

    const ok = () =>
      HttpServerResponse.jsonUnsafe({ ok: true }, { headers: { 'cache-control': 'no-store' } });

    const resolveMention = ({ event_id, team_id, event }: MentionEnvelope): MentionEvent => ({
      eventId: event_id,
      teamId: team_id,
      channelId: event.channel,
      ts: event.ts,
      threadTs: event.thread_ts || event.ts,
      userId: event.user,
      text: event.text ?? '',
    });

    const resolveThreadEntry = (message: ThreadMessage): ThreadEntry | null => {
      const userId = message.user ?? message.bot_id;
      if (!userId) return null;
      const botName =
        message.bot_id === undefined ? null : (message.bot_profile?.name ?? message.username ?? 'Bot');
      return { ts: message.ts, userId, text: message.text ?? '', botName };
    };

    const resolveAnswerClick = (actions: BlockActions): AnswerClick | null => {
      const [action] = actions.actions;
      const value = parseSlackAnswerValue(action.value);
      const interactionId = actions.trigger_id ?? action.action_ts;
      if (!action.action_id.startsWith(`${SLACK_ANSWER_ACTION}.`) || !value || !interactionId) return null;
      if (!actions.response_url.startsWith(RESPONSE_URL_ORIGIN)) return null;
      const { message } = actions;
      return {
        answer: {
          interactionId: interactionId.slice(0, SLACK_LIMITS.id),
          teamId: actions.team.id,
          channelId: actions.channel.id,
          threadTs: message.thread_ts || message.ts,
          messageTs: message.ts,
          userId: actions.user.id,
          gateId: value.gateId,
          choice: value.choice,
        },
        responseUrl: actions.response_url,
        message: { text: message.text ?? '', blocks: message.blocks ?? [] },
      };
    };

    const listThreadEntries = Effect.fn('slackEvents.listThreadEntries')(function* (
      mention: MentionEvent,
      token: Redacted.Redacted<string>
    ) {
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
            const entries = (replies.messages ?? [])
              .map((value) => Option.getOrNull(Option.map(decodeThreadMessage(value), resolveThreadEntry)))
              .filter((entry) => entry !== null);
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
      const entries = (yield* listThreadEntries(mention, token)).slice(-SLACK_LIMITS.threadMessages);
      const users = yield* resolveUserNames(entries, token);
      const names = { users, botUserId: workspace.botUserId };
      const readable = (text: string) => resolveSlackReadableText(text, names).slice(0, SLACK_LIMITS.text);
      const nameOf = (id: string) => (users.get(id) ?? id).slice(0, SLACK_LIMITS.userName);
      const thread = entries.map((entry): SlackThreadMessage => ({
        ts: entry.ts,
        userId: entry.userId,
        userName: (entry.botName ?? nameOf(entry.userId)).slice(0, SLACK_LIMITS.userName),
        text: readable(entry.text),
        bot: entry.botName !== null || entry.userId === workspace.botUserId,
      }));
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
      if (Option.isNone(answer) || TUNNEL_OFFLINE_STATUSES.has(answer.value.status)) return false;
      if (!answer.value.ok)
        yield* Effect.logError('[Cloud] A machine refused a Slack mention').pipe(
          Effect.annotateLogs({ instanceId: machine.id, status: answer.value.status })
        );
      return true;
    });

    const handleMention = Effect.fn('slackEvents.handleMention')(function* (mention: MentionEvent) {
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
        yield* postInThread(
          serializeSlackOffline(Option.isSome(machine) ? machine.value.name : 'Your machine')
        );
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
      const { answer } = click;
      const respondInSlack = (body: Readonly<Record<string, unknown>>) =>
        client.execute(
          HttpClientRequest.post(click.responseUrl).pipe(HttpClientRequest.bodyJsonUnsafe(body))
        );
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

    const respondEvents = Effect.gen(function* () {
      const body = yield* readSignedBody('event');
      const fields = decodeJson(body);
      if (Option.isNone(fields)) return yield* new BodyInvalid({ message: 'The Slack event is not JSON.' });
      const envelope = decodeEnvelope(fields.value);
      if (Option.isNone(envelope)) return ok();
      const { type, challenge, event_id: eventId } = envelope.value;
      if (type === 'url_verification') return HttpServerResponse.jsonUnsafe({ challenge });
      if (type !== 'event_callback' || !eventId || !(yield* store.recordEvent(eventId))) return ok();
      const uninstall = decodeUninstall(fields.value);
      if (Option.isSome(uninstall)) {
        yield* store.removeWorkspace(uninstall.value.team_id);
        return ok();
      }
      const mention = Option.map(decodeMention(fields.value), resolveMention);
      if (Option.isSome(mention))
        yield* deferWork(
          handleMention(mention.value).pipe(
            Effect.catchCause((cause) =>
              Effect.logError('[Cloud] A Slack mention could not be forwarded').pipe(
                Effect.annotateLogs({
                  cause: Cause.pretty(cause),
                  teamId: mention.value.teamId,
                  eventId: mention.value.eventId,
                })
              )
            )
          )
        );
      return ok();
    });

    const respondInteractions = Effect.gen(function* () {
      const body = yield* readSignedBody('interaction');
      const form = decodeForm(Object.fromEntries(new URLSearchParams(body)));
      const payload = Option.flatMap(form, (fields) => decodeJson(fields.payload));
      if (Option.isNone(payload))
        return yield* new BodyInvalid({ message: 'The Slack interaction is not JSON.' });
      const click = Option.getOrNull(Option.map(decodeBlockActions(payload.value), resolveAnswerClick));
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

    return Layer.mergeAll(
      HttpRouter.add('POST', SLACK_RELAY_PATHS.events, respondEvents),
      HttpRouter.add('POST', SLACK_RELAY_PATHS.interactions, respondInteractions)
    );
  })
);
