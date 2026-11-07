import {
  isSlackWriteDecision,
  listSlackDecidedBlocks,
  listSlackMentionedUsers,
  parseSlackDecisionModal,
  parseSlackDecisionReply,
  parseSlackDecisionValue,
  resolveSlackReadableText,
  SLACK_DECIDE_ACTION,
  SLACK_ENGINE_EVENTS_PATH,
  SLACK_ENGINE_INTERACTIONS_PATH,
  SLACK_LIMITS,
  SLACK_MODAL_CALLBACK,
  SLACK_RELAY_PATHS,
  SLACK_RESPONSE_INPUT,
  SLACK_VIEW_LIMITS,
  SLACK_WRITE_ACTION,
  type SlackDecision,
  type SlackDecisionReply,
  type SlackMention,
  type SlackMessage,
  type SlackThreadMessage,
  serializeSlackDecidedView,
  serializeSlackDecisionModal,
  serializeSlackLinkPrompt,
  serializeSlackOffline,
} from '@shinsa/core';
import { BodyInvalid } from '@shinsa/core/remote/errors';
import { Cause, Clock, Effect, Layer, Option, type Redacted, Schema } from 'effect';
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from 'effect/http';
import { selectMachineRole } from '../../auth/access.ts';
import { CloudConfig } from '../../config/service.ts';
import { isMachineOnline } from '../../domain/machines.ts';
import { requestOnlineMachine } from '../../http/forward.ts';
import { deferWork } from '../../http/worker.ts';
import { SlackApi } from '../../integrations/slack/service.ts';
import { readSignedBody } from '../../slack/signed-body.ts';
import { requestSignedMachine, selectWorkspaceToken } from '../../slack/workspace.ts';
import type { Machine } from '../../store/machines/schema.ts';
import { Machines } from '../../store/machines/service.ts';
import type { SlackWorkspace } from '../../store/slack/schema.ts';
import { SlackStore } from '../../store/slack/service.ts';
import { resolveSlackMessageText } from './message.ts';
import {
  type BlockActions,
  BlockActions as BlockActionsSchema,
  type CardMessage,
  type DeciderCheck,
  type Interaction,
  EventEnvelope,
  InteractionForm,
  JsonObject,
  MentionEnvelope,
  type MentionEvent,
  ChannelInfo,
  Permalink,
  RESPONSE_URL_ORIGIN,
  Replies,
  SLACK_DECISION_REFUSALS,
  SLACK_NAMED_USERS_LIMIT,
  type SlackCard,
  type ThreadEntry,
  ThreadMessage,
  UninstallEvent,
  type ViewSubmission,
  ViewSubmission as ViewSubmissionSchema,
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
    const decodeSubmission = Schema.decodeUnknownOption(ViewSubmissionSchema);

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

    const resolveThreadEntry = (message: ThreadMessage, botUserId: string): ThreadEntry | null => {
      const userId = message.user ?? message.bot_id;
      if (!userId) return null;
      const botName =
        message.bot_id === undefined ? null : (message.bot_profile?.name ?? message.username ?? 'Bot');
      const text = userId === botUserId ? (message.text ?? '') : resolveSlackMessageText(message);
      return { ts: message.ts, userId, text, botName };
    };

    const resolveCardMessage = (actions: BlockActions): CardMessage => ({
      responseUrl: actions.response_url,
      text: actions.message.text ?? '',
      blocks: actions.message.blocks ?? [],
    });

    const resolveClick = (actions: BlockActions): Interaction | null => {
      const [action] = actions.actions;
      const value = parseSlackDecisionValue(action.value);
      const interactionId = actions.trigger_id ?? action.action_ts;
      if (!value || !interactionId || !actions.response_url.startsWith(RESPONSE_URL_ORIGIN)) return null;
      const { message } = actions;
      const place = {
        channelId: actions.channel.id,
        threadTs: message.thread_ts || message.ts,
        messageTs: message.ts,
      };
      if (action.action_id.startsWith(`${SLACK_DECIDE_ACTION}.`))
        return {
          kind: 'decide',
          decision: {
            ...value,
            ...place,
            interactionId: interactionId.slice(0, SLACK_LIMITS.id),
            teamId: actions.team.id,
            userId: actions.user.id,
            response: null,
          },
          message: resolveCardMessage(actions),
        };
      const writes =
        action.action_id.startsWith(`${SLACK_WRITE_ACTION}.`) && isSlackWriteDecision(value.decision);
      if (!writes || !actions.trigger_id) return null;
      return {
        kind: 'write',
        card: { teamId: actions.team.id, ...place, userId: actions.user.id },
        triggerId: actions.trigger_id,
        modal: { ...value, ...place },
        message: resolveCardMessage(actions),
      };
    };

    const resolveSubmission = (submission: ViewSubmission): Interaction | null => {
      const { view } = submission;
      if (view.callback_id !== SLACK_MODAL_CALLBACK) return null;
      const modal = parseSlackDecisionModal(view.private_metadata);
      const text =
        view.state.values[SLACK_RESPONSE_INPUT.block]?.[SLACK_RESPONSE_INPUT.action]?.value?.trim();
      if (!modal || !text) return null;
      return {
        kind: 'submit',
        decision: {
          ...modal,
          interactionId: (submission.trigger_id ?? view.id).slice(0, SLACK_LIMITS.id),
          teamId: submission.team.id,
          userId: submission.user.id,
          response: text.slice(0, SLACK_VIEW_LIMITS.input),
        },
      };
    };

    const listThreadEntries = Effect.fn('slackEvents.listThreadEntries')(function* (
      mention: MentionEvent,
      botUserId: string,
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
              .map((value) =>
                Option.getOrNull(
                  Option.map(decodeThreadMessage(value), (message) => resolveThreadEntry(message, botUserId))
                )
              )
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
      const entries = (yield* listThreadEntries(mention, workspace.botUserId, token)).slice(
        -SLACK_LIMITS.threadMessages
      );
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
      const channelName = yield* slack
        .call('conversations.info', { token, body: { form: { channel: mention.channelId } } }, ChannelInfo)
        .pipe(
          Effect.map((answer) => answer.channel?.name?.slice(0, SLACK_LIMITS.channelName) || null),
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
        channelName,
        thread,
      } satisfies SlackMention;
    });

    const forwardMention = Effect.fn('slackEvents.forwardMention')(function* (
      mention: SlackMention,
      machine: Machine
    ) {
      const answer = yield* requestOnlineMachine(
        'slack',
        machine.id,
        requestSignedMachine(machine, SLACK_ENGINE_EVENTS_PATH, mention)
      );
      if (Option.isNone(answer)) return false;
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
      const machine = yield* machines.select(link.value.machineId);
      const now = yield* Clock.currentTimeMillis;
      if (Option.isNone(machine) || !isMachineOnline(machine.value, now)) {
        yield* postInThread(
          serializeSlackOffline(Option.isSome(machine) ? machine.value.name : 'Your machine')
        );
        return;
      }
      const forwarded = yield* resolveForwardedMention(mention, workspace, token);
      yield* store.recordThread(
        { workspaceId: mention.teamId, channelId: mention.channelId, threadTs: mention.threadTs },
        machine.value.id
      );
      if (!(yield* forwardMention(forwarded, machine.value)))
        yield* postInThread(serializeSlackOffline(machine.value.name));
    });

    const serializeOfflineRefusal = (name: string) =>
      `${name} is offline, so nothing was sent. Try again once Shinsa runs there.`;

    const checkDecider = Effect.fn('slackEvents.checkDecider')(function* (card: SlackCard) {
      const refuse = (reason: string): DeciderCheck => ({ allowed: false, reason });
      const link = yield* store.selectLink(card.teamId, card.userId);
      if (Option.isNone(link)) return refuse(SLACK_DECISION_REFUSALS.notLinked);
      const poster = yield* store.selectPoster({
        workspaceId: card.teamId,
        channelId: card.channelId,
        ts: card.messageTs,
      });
      const machine = Option.isSome(poster) ? yield* machines.select(poster.value) : Option.none<Machine>();
      if (Option.isNone(machine)) return refuse(SLACK_DECISION_REFUSALS.noAccess);
      const role = yield* selectMachineRole(machine.value.id, machine.value.ownerId, link.value.userId);
      if (Option.isNone(role) || role.value === 'guest') return refuse(SLACK_DECISION_REFUSALS.noAccess);
      if (!isMachineOnline(machine.value, yield* Clock.currentTimeMillis))
        return refuse(serializeOfflineRefusal(machine.value.name));
      return { allowed: true, machine: machine.value } satisfies DeciderCheck;
    });

    const requestDecision = Effect.fn('slackEvents.requestDecision')(function* (
      machine: Machine,
      decision: SlackDecision
    ) {
      const response = yield* Effect.option(
        requestSignedMachine(machine, SLACK_ENGINE_INTERACTIONS_PATH, decision)
      );
      if (Option.isNone(response) || !response.value.ok) return null;
      const reply = yield* Effect.option(Effect.tryPromise(() => response.value.json()));
      return Option.match(reply, { onNone: () => null, onSome: parseSlackDecisionReply });
    });

    const respondToClick = (message: CardMessage, body: Readonly<Record<string, unknown>>) =>
      client.execute(
        HttpClientRequest.post(message.responseUrl).pipe(HttpClientRequest.bodyJsonUnsafe(body))
      );

    const respondPrivatelyToClick = (message: CardMessage, text: string) =>
      respondToClick(message, { response_type: 'ephemeral', replace_original: false, text });

    const respondPrivatelyInThread = Effect.fn('slackEvents.respondPrivatelyInThread')(function* (
      decision: SlackDecision,
      text: string
    ) {
      const opened = yield* selectWorkspaceToken(decision.teamId);
      if (Option.isNone(opened)) return;
      yield* slack.call(
        'chat.postEphemeral',
        {
          token: opened.value.token,
          body: {
            json: {
              channel: decision.channelId,
              user: decision.userId,
              thread_ts: decision.threadTs,
              text,
            },
          },
        },
        Schema.Unknown
      );
    });

    const sendDecision = Effect.fn('slackEvents.sendDecision')(function* (decision: SlackDecision) {
      const check = yield* checkDecider(decision);
      if (!check.allowed) return { decided: false, reason: check.reason } satisfies SlackDecisionReply;
      const reply = yield* requestDecision(check.machine, decision);
      return (
        reply ??
        ({ decided: false, reason: serializeOfflineRefusal(check.machine.name) } satisfies SlackDecisionReply)
      );
    });

    const handleDecide = Effect.fn('slackEvents.handleDecide')(function* (
      decision: SlackDecision,
      message: CardMessage
    ) {
      const result = yield* sendDecision(decision);
      if (!result.decided) return yield* respondPrivatelyToClick(message, result.reason);
      return yield* respondToClick(message, {
        replace_original: true,
        text: message.text,
        blocks: listSlackDecidedBlocks(
          [...message.blocks],
          serializeSlackDecidedView(result.text, decision.userId)
        ),
      });
    });

    const handleWrite = Effect.fn('slackEvents.handleWrite')(function* (
      interaction: Extract<Interaction, { kind: 'write' }>
    ) {
      const check = yield* checkDecider(interaction.card);
      if (!check.allowed) return yield* respondPrivatelyToClick(interaction.message, check.reason);
      const opened = yield* selectWorkspaceToken(interaction.card.teamId);
      const view = serializeSlackDecisionModal(interaction.modal);
      if (Option.isNone(opened) || !view) return;
      yield* slack
        .call(
          'views.open',
          { token: opened.value.token, body: { json: { trigger_id: interaction.triggerId, view } } },
          Schema.Unknown
        )
        .pipe(
          Effect.catchTag('SlackCallFailed', (error) =>
            Effect.andThen(
              Effect.logError('[Cloud] A Slack form could not open').pipe(
                Effect.annotateLogs({ error, teamId: interaction.card.teamId })
              ),
              respondPrivatelyToClick(interaction.message, SLACK_DECISION_REFUSALS.formFailed)
            )
          )
        );
    });

    const handleSubmit = Effect.fn('slackEvents.handleSubmit')(function* (decision: SlackDecision) {
      const result = yield* sendDecision(decision);
      if (!result.decided) yield* respondPrivatelyInThread(decision, result.reason);
    });

    const handleInteraction = Effect.fn('slackEvents.handleInteraction')(function* (
      interaction: Interaction
    ) {
      switch (interaction.kind) {
        case 'decide':
          return yield* Effect.asVoid(handleDecide(interaction.decision, interaction.message));
        case 'write':
          return yield* handleWrite(interaction);
        case 'submit':
          return yield* handleSubmit(interaction.decision);
      }
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
      const interaction = Option.getOrNull(
        Option.orElse(Option.map(decodeBlockActions(payload.value), resolveClick), () =>
          Option.map(decodeSubmission(payload.value), resolveSubmission)
        )
      );
      if (interaction)
        yield* deferWork(
          handleInteraction(interaction).pipe(
            Effect.asVoid,
            Effect.catchCause((cause) =>
              Effect.logError('[Cloud] A Slack decision could not be passed on').pipe(
                Effect.annotateLogs({
                  cause: Cause.pretty(cause),
                  kind: interaction.kind,
                  teamId:
                    interaction.kind === 'write' ? interaction.card.teamId : interaction.decision.teamId,
                })
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
