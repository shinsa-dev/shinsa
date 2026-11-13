import { randomBytes } from 'node:crypto';
import {
  DomainError,
  listSlackChannelSchedules,
  listSlackChannelWatches,
  listSlackStatusGates,
  parseSlackChannelMessage,
  parseSlackDecision,
  parseSlackEvaluation,
  parseSlackMention,
  resolveSlackConnectUrl,
  resolveSlackEscalationFollowUp,
  resolveSlackEscalationMessage,
  serializeSlackEscalationTest,
  resolveSlackEscalationUrl,
  resolveSlackPostMessage,
  resolveSlackReaction,
  resolveSlackSessionStatus,
  resolveSlackLastUsedAt,
  resolveSlackMergeMessage,
  resolveSlackMessageKey,
  resolveSlackTaskUrl,
  resolveSlackThreadKey,
  selectSlackEscalationPost,
  SLACK_ENGINE_INTERACTIONS_PATH,
  SLACK_ENGINE_MESSAGES_PATH,
  SLACK_EVALUATION_SCHEMA,
  SLACK_EVALUATION_SYSTEM,
  SLACK_FORWARD_HEADERS,
  SLACK_LIMITS,
  SLACK_NOT_CONNECTED,
  SLACK_REACTIONS,
  type AutopilotContact,
  type Schedule,
  type SlackChannel,
  type SlackChannelMessage,
  type SlackDecisionReply,
  type SlackEscalationPost,
  type SlackRelayNotify,
  type SlackDirectoryView,
  type SlackMessage,
  type SlackSessionStatus,
  type SlackSnapshot,
  type ShinsaCommand,
  type TaskOwner,
  type SlackThreadRef,
  serializeSlackCard,
  serializeSlackChannelDelivery,
  serializeSlackDeclined,
  serializeSlackEvaluationPrompt,
  serializeSlackNoAccess,
  verifySlackForwardSignature,
  type SlackLink,
  resolveSlackFilterSubject,
  SCHEDULE_FILTER_SKIPPED,
} from '@shinsa/core';
import type { SlackTestOutcome } from '@shinsa/core/engine-api/schema';
import { serializeRemoteFailure } from '@shinsa/core/remote/errors';
import {
  Clock,
  Context,
  Duration,
  Effect,
  FiberSet,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
  Semaphore,
} from 'effect';
import { QuickCalls } from '../agents/quick/service.ts';
import { describeError } from '../log/redact.ts';
import { RELAY_FAILED_CODE } from '../remote/client/schema.ts';
import { RemoteClient } from '../remote/client/service.ts';
import { EngineCore } from '../runtime/engine/service.ts';
import { ScheduleFilter } from '../schedules/filter/service.ts';
import { resolvePromptProblem } from '../schedules/prompt.ts';
import { FRAME_ID_BYTES, RATE_WINDOW_MS, WEBHOOK_RATE_LIMIT_PER_MINUTE } from '../schedules/schema.ts';
import {
  SLACK_EVENT_BODY_LIMIT_BYTES,
  SLACK_MESSAGE_RATE_LIMITED,
  SlackBodyText,
  type SlackEffect,
  type SlackInput,
  type SlackLinksFailure,
  type SlackRefusal,
  type SlackRelayFailure,
  SlackRequestUnreadable,
  SLACK_REMOTE_OFF_PROBLEM,
  SLACK_UNREACHABLE_PROBLEM,
  SlackStatusInterval,
  type SlackNotifyRefusal,
} from './schema.ts';

export class Slack extends Context.Service<
  Slack,
  {
    readonly handleEvents: (
      request: Request
    ) => Effect.Effect<Response, SlackRequestUnreadable | SlackRefusal>;
    readonly handleInteractions: (
      request: Request
    ) => Effect.Effect<Response, SlackRequestUnreadable | SlackRefusal>;
    readonly handleMessages: (
      request: Request
    ) => Effect.Effect<Response, SlackRequestUnreadable | SlackRefusal>;
    readonly handleTunnel: (
      request: Request,
      url: URL
    ) => Effect.Effect<Response, SlackRequestUnreadable | SlackRefusal>;
    readonly evaluate: (
      effect: SlackEffect<'slack.evaluate'>,
      key: string
    ) => Effect.Effect<void, SlackRefusal | SlackRelayFailure>;
    readonly post: (effect: SlackEffect<'slack.post'>) => Effect.Effect<void, SlackRelayFailure>;
    readonly merge: (
      effect: SlackEffect<'slack.merge'>,
      key: string
    ) => Effect.Effect<void, SlackRefusal | SlackRelayFailure>;
    readonly react: (effect: SlackEffect<'slack.react'>) => Effect.Effect<void>;
    readonly escalate: (
      effect: SlackEffect<'slack.escalate'>,
      key: string
    ) => Effect.Effect<void, SlackRefusal | SlackRelayFailure>;
    readonly directory: (teamId: string) => Effect.Effect<SlackDirectoryView>;
    readonly testContact: (contact: AutopilotContact) => Effect.Effect<SlackTestOutcome>;
    readonly status: (
      effect: SlackEffect<'slack.status'>,
      key: string
    ) => Effect.Effect<void, SlackRefusal | SlackRelayFailure>;
    readonly snapshot: (viewer: string | null) => Effect.Effect<SlackSnapshot>;
    readonly disconnect: Effect.Effect<SlackSnapshot, SlackLinksFailure>;
    readonly channels: Effect.Effect<readonly SlackChannel[], DomainError>;
    readonly start: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly settle: Effect.Effect<void>;
  }
>()('shinsa/engine/slack/Slack') {
  static readonly layer = (input: SlackInput) =>
    Layer.effect(
      Slack,
      Effect.gen(function* () {
        const engine = yield* EngineCore;
        const quick = yield* QuickCalls;
        const filter = yield* ScheduleFilter;
        const relay = (yield* RemoteClient).slack;
        const statusInterval = yield* SlackStatusInterval;
        const token = (machineToken: string) => Redacted.make(machineToken);
        const dispatch = (command: ShinsaCommand, id: string, actor: TaskOwner | null = null) =>
          engine.dispatch(command, { id, actor });
        const statusAt = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
        const statusShown = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
        const mergeShown = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
        const sessionShown = yield* Ref.make<ReadonlyMap<string, SlackSessionStatus>>(new Map());
        const declined = yield* Ref.make<ReadonlySet<string>>(new Set());
        const sessionRefused = yield* Ref.make<ReadonlySet<string>>(new Set());
        const decodeBody = Schema.decodeUnknownOption(SlackBodyText);
        const active = yield* Ref.make(false);
        const watched = yield* Ref.make('[]');
        const syncing = yield* Semaphore.make(1);
        const windows = yield* Ref.make<ReadonlyMap<string, readonly number[]>>(new Map());
        const limited = yield* Ref.make<ReadonlySet<string>>(new Set());

        const respondJsonError = (code: string, message: string, status: number) =>
          Response.json({ error: { code, message } }, { status });

        const describeFailureCode = (failure: { readonly _tag: string; readonly message: string }) =>
          failure._tag === 'RemoteUnreachable'
            ? RELAY_FAILED_CODE
            : serializeRemoteFailure(failure).body.error.code;

        const readSigned = Effect.fn('Slack.readSigned')(function* (request: Request) {
          const credentials = yield* input.credentials;
          if (!credentials) return respondJsonError('not_found', 'No such endpoint.', 404);
          const body = yield* Effect.tryPromise({
            try: () => request.text(),
            catch: (error) => new SlackRequestUnreadable({ message: describeError(error) }),
          });
          if (body.length > SLACK_EVENT_BODY_LIMIT_BYTES)
            return respondJsonError('body_too_large', 'The request is over 1 MB.', 413);
          const now = yield* Clock.currentTimeMillis;
          const signed = yield* verifySlackForwardSignature(
            credentials.connectKey,
            {
              signature: request.headers.get(SLACK_FORWARD_HEADERS.signature),
              timestamp: request.headers.get(SLACK_FORWARD_HEADERS.timestamp),
            },
            body,
            now
          );
          if (!signed)
            return respondJsonError('unauthorized', 'The request is not signed by app.shinsa.dev.', 401);
          const value = decodeBody(body);
          if (Option.isNone(value)) return respondJsonError('body_invalid', 'The request is not JSON.', 400);
          return { value: value.value };
        });

        const handleEvents = Effect.fn('Slack.handleEvents')(function* (request: Request) {
          const read = yield* readSigned(request);
          if (read instanceof Response) return read;
          const parsed = parseSlackMention(read.value);
          if (Option.isNone(parsed))
            return respondJsonError('body_invalid', 'The mention is missing a part.', 400);
          const mention = parsed.value;
          yield* dispatch({ type: 'slack.mention', mention }, `slack:${mention.eventId}`);
          return Response.json({ ok: true }, { status: 202 });
        });

        const handleInteractions = Effect.fn('Slack.handleInteractions')(function* (request: Request) {
          const read = yield* readSigned(request);
          if (read instanceof Response) return read;
          const parsed = parseSlackDecision(read.value);
          if (Option.isNone(parsed))
            return respondJsonError('body_invalid', 'The decision is missing a part.', 400);
          const decision = parsed.value;
          return yield* dispatch(
            { type: 'slack.decide', decision },
            `slack-decide:${decision.interactionId}`
          ).pipe(
            Effect.andThen(engine.state),
            Effect.map((state) => {
              const taskId = state.gates[decision.gateId]?.taskId;
              const decided: SlackDecisionReply = {
                decided: true,
                text: (taskId ? state.tasks[taskId]?.slack?.decided?.text : null) ?? 'decided',
              };
              return Response.json(decided);
            }),
            Effect.catchTag('DomainError', (error) => {
              const refused: SlackDecisionReply = { decided: false, reason: error.message };
              return Effect.succeed(Response.json(refused));
            })
          );
        });

        const syncWatches = (force: boolean) =>
          Semaphore.withPermit(
            syncing,
            Effect.gen(function* () {
              const credentials = yield* input.credentials;
              if (!credentials) return;
              const watches = listSlackChannelWatches(yield* engine.state).slice(0, SLACK_LIMITS.watches);
              const key = JSON.stringify(watches);
              const known = yield* Ref.get(watched);
              if (key === known && !(force && watches.length > 0)) return;
              yield* relay.watches(token(credentials.machineToken), { watches }).pipe(
                Effect.andThen(Ref.set(watched, key)),
                Effect.catch((failure) =>
                  Effect.logWarning('[Slack] The watched channels could not be sent to app.shinsa.dev').pipe(
                    Effect.annotateLogs({ channels: watches.length, error: describeError(failure) })
                  )
                )
              );
            })
          );

        const deliveries = yield* FiberSet.make<void>();
        const runFork = Effect.runForkWith(yield* Effect.context<never>());
        yield* engine.observe(() => {
          runFork(Effect.when(syncWatches(false), Ref.get(active)));
        });

        const start = Effect.andThen(Ref.set(active, true), syncWatches(true));

        const stop = Ref.set(active, false);

        const takeSlot = Effect.fn('Slack.takeSlot')(function* (scheduleId: string) {
          const now = yield* Clock.currentTimeMillis;
          const taken = yield* Ref.modify(windows, (open) => {
            const recent = (open.get(scheduleId) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
            const full = recent.length >= WEBHOOK_RATE_LIMIT_PER_MINUTE;
            return [!full, new Map(open).set(scheduleId, full ? recent : [...recent, now])];
          });
          const told = yield* Ref.modify(limited, (ids) => {
            const next = new Set(ids);
            if (taken) next.delete(scheduleId);
            else next.add(scheduleId);
            return [ids.has(scheduleId), next];
          });
          if (taken) return 'taken' as const;
          return told ? ('skipped' as const) : ('limited' as const);
        });

        const deliverMessage = Effect.fn('Slack.deliverMessage')(function* (
          schedule: Schedule,
          message: SlackChannelMessage
        ) {
          const id = `slack-message:${schedule.id}:${message.eventId}`;
          const fail = (detail: string) =>
            dispatch(
              {
                type: 'schedule.fail',
                scheduleId: schedule.id,
                dueAt: null,
                deliveryId: message.eventId,
                detail,
              },
              `${id}:fail`
            );
          const replayKey = resolveSlackMessageKey(message);
          const now = yield* Clock.currentTimeMillis;
          if ((schedule.replayKeys[replayKey] ?? 0) > now) return;
          const slot = yield* takeSlot(schedule.id);
          if (slot === 'skipped') return;
          if (slot === 'limited') return yield* fail(SLACK_MESSAGE_RATE_LIMITED);
          const prompt = serializeSlackChannelDelivery(
            schedule.text,
            message,
            randomBytes(FRAME_ID_BYTES).toString('hex')
          );
          const problem = resolvePromptProblem(prompt);
          if (problem) return yield* fail(problem);
          if (!(yield* filter.applies(schedule, resolveSlackFilterSubject(message)))) {
            yield* dispatch(
              {
                type: 'schedule.skip',
                scheduleId: schedule.id,
                deliveryId: message.eventId,
                detail: SCHEDULE_FILTER_SKIPPED,
                replayKey,
              },
              `${id}:skip`
            );
            return;
          }
          yield* dispatch(
            {
              type: 'schedule.deliver',
              scheduleId: schedule.id,
              deliveryId: message.eventId,
              text: prompt,
              replayKey,
              slackMessage: {
                teamId: message.teamId,
                channelId: message.channelId,
                messageTs: message.messageTs,
                userId: message.userId,
                permalink: message.permalink,
                channelName: message.channelName,
              },
            },
            id
          ).pipe(
            Effect.catchTag('DomainError', (error) =>
              Effect.logWarning('[Slack] A channel message could not run its automation').pipe(
                Effect.annotateLogs({ scheduleId: schedule.id, error: error.message }),
                Effect.andThen(fail(error.message))
              )
            )
          );
        });

        const handleMessages = Effect.fn('Slack.handleMessages')(function* (request: Request) {
          const read = yield* readSigned(request);
          if (read instanceof Response) return read;
          const parsed = parseSlackChannelMessage(read.value);
          if (Option.isNone(parsed))
            return respondJsonError('body_invalid', 'The message is missing a part.', 400);
          const message = parsed.value;
          const schedules = listSlackChannelSchedules(yield* engine.state, message);
          if (schedules.length === 0) {
            yield* Ref.set(watched, '');
            yield* syncWatches(false);
          }
          yield* Effect.forEach(
            schedules,
            (schedule) => FiberSet.run(deliveries, deliverMessage(schedule, message)),
            { discard: true }
          );
          return Response.json({ ok: true, delivered: schedules.length }, { status: 202 });
        });

        const handleTunnel = (request: Request, url: URL) => {
          if (url.pathname === SLACK_ENGINE_INTERACTIONS_PATH) return handleInteractions(request);
          return url.pathname === SLACK_ENGINE_MESSAGES_PATH
            ? handleMessages(request)
            : handleEvents(request);
        };

        const resolveTaskUrl = (taskId: string) => resolveSlackTaskUrl(input.appOrigin, taskId);

        const send = Effect.fn('Slack.send')(function* (
          thread: SlackThreadRef,
          replaceTs: string | null,
          message: SlackMessage
        ) {
          const credentials = yield* input.credentials;
          if (!credentials) {
            yield* Effect.logWarning('[Slack] Remote access is off, so nothing was posted').pipe(
              Effect.annotateLogs({ threadTs: thread.threadTs })
            );
            return null;
          }
          return yield* relay
            .post(token(credentials.machineToken), {
              teamId: thread.teamId,
              channelId: thread.channelId,
              threadTs: thread.threadTs,
              replaceTs,
              message,
            })
            .pipe(
              Effect.map((posted): string | null => posted.ts),
              Effect.catch((failure) => {
                if (
                  failure._tag === 'SlackFailed' ||
                  (failure._tag === 'RemoteUnreachable' && failure.retryable)
                )
                  return Effect.fail(failure);
                return Effect.logWarning('[Slack] app.shinsa.dev refused the post').pipe(
                  Effect.annotateLogs({
                    code: describeFailureCode(failure),
                    threadTs: thread.threadTs,
                    error: describeError(failure),
                  }),
                  Effect.as(null)
                );
              })
            );
        });

        const applyReaction = Effect.fn('Slack.applyReaction')(function* (
          thread: SlackThreadRef,
          messageTs: string,
          add: string | null,
          remove: string | null
        ) {
          const credentials = yield* input.credentials;
          if (!credentials || add === remove) return;
          yield* relay
            .react(token(credentials.machineToken), {
              teamId: thread.teamId,
              channelId: thread.channelId,
              threadTs: thread.threadTs,
              messageTs,
              add,
              remove,
            })
            .pipe(
              Effect.flatMap(({ applied }) =>
                applied
                  ? Effect.void
                  : Effect.logInfo('[Slack] Slack did not take the reaction').pipe(
                      Effect.annotateLogs({ messageTs, add })
                    )
              ),
              Effect.catch((failure) =>
                Effect.logWarning('[Slack] The reaction could not be set').pipe(
                  Effect.annotateLogs({ messageTs, add, error: describeError(failure) })
                )
              )
            );
        });

        const syncSession = Effect.fn('Slack.syncSession')(function* (
          thread: SlackThreadRef,
          taskId: string,
          status: SlackSessionStatus
        ) {
          const credentials = yield* input.credentials;
          if (
            !credentials ||
            (yield* Ref.get(sessionRefused)).has(thread.teamId) ||
            (yield* Ref.get(sessionShown)).get(taskId) === status
          )
            return;
          const applied = yield* relay
            .session(token(credentials.machineToken), {
              teamId: thread.teamId,
              channelId: thread.channelId,
              threadTs: thread.threadTs,
              status,
            })
            .pipe(
              Effect.map((answer): boolean | null => answer.applied),
              Effect.catch((failure) =>
                Effect.logWarning('[Slack] The thread status could not be set').pipe(
                  Effect.annotateLogs({ taskId, status, error: describeError(failure) }),
                  Effect.as(null)
                )
              )
            );
          if (applied === null) return;
          yield* Ref.update(sessionShown, (shown) => new Map(shown).set(taskId, status));
          if (applied) return;
          yield* Ref.update(sessionRefused, (refused) => new Set(refused).add(thread.teamId));
          yield* Effect.logInfo('[Slack] Slack does not show a thread status in this workspace').pipe(
            Effect.annotateLogs({ taskId, teamId: thread.teamId })
          );
        });

        const evaluate = Effect.fn('Slack.evaluate')(function* (
          effect: SlackEffect<'slack.evaluate'>,
          key: string
        ) {
          const { mention } = effect;
          const actor =
            mention.linkedUserId === null ? null : yield* input.resolveActor(mention.linkedUserId);
          if (mention.linkedUserId !== null && actor === null) {
            yield* send(mention, null, serializeSlackNoAccess());
            return;
          }
          yield* applyReaction(mention, mention.messageTs, SLACK_REACTIONS.sizing, null);
          const said = yield* quick.classify<unknown>(
            SLACK_EVALUATION_SYSTEM,
            serializeSlackEvaluationPrompt(mention),
            SLACK_EVALUATION_SCHEMA
          );
          if (Option.contains(parseSlackEvaluation(said), 'none')) {
            yield* applyReaction(mention, mention.messageTs, null, SLACK_REACTIONS.sizing);
            const threadKey = resolveSlackThreadKey(mention);
            const seen = yield* Ref.modify(declined, (keys) => [
              keys.has(threadKey),
              new Set(keys).add(threadKey),
            ]);
            if (seen) return;
            yield* send(mention, null, serializeSlackDeclined());
            return;
          }
          yield* dispatch({ type: 'slack.start_task', mention }, `${key}:slack.start_task`, actor);
        });

        const post = Effect.fn('Slack.post')(function* (effect: SlackEffect<'slack.post'>) {
          const message = resolveSlackPostMessage(
            yield* engine.state,
            effect.post,
            effect.taskId,
            resolveTaskUrl
          );
          if (Option.isNone(message)) return;
          yield* send(effect.thread, null, message.value);
        });

        const merge = Effect.fn('Slack.merge')(function* (effect: SlackEffect<'slack.merge'>, key: string) {
          const state = yield* engine.state;
          const message = Option.getOrNull(
            resolveSlackMergeMessage(state, effect.taskId, effect.round, resolveTaskUrl(effect.taskId))
          );
          const posted = state.tasks[effect.taskId]?.slack?.merge;
          if (!message || posted?.round !== effect.round) return;
          const shown = JSON.stringify(message);
          const shownKey = `${effect.taskId}:${effect.round}`;
          if (posted.ts && (yield* Ref.get(mergeShown)).get(shownKey) === shown) return;
          const ts = yield* send(effect.thread, posted.ts, message);
          if (!ts) return;
          yield* Ref.update(mergeShown, (messages) => new Map(messages).set(shownKey, shown));
          if (ts === posted.ts) return;
          yield* dispatch(
            { type: 'slack.record_merge', taskId: effect.taskId, round: effect.round, ts },
            `${key}:slack.record_merge`
          );
        });

        const react = (effect: SlackEffect<'slack.react'>) =>
          applyReaction(effect.thread, effect.messageTs, effect.reaction, null);

        const describeEscalationProblem = (failure: SlackRelayFailure | SlackNotifyRefusal) =>
          failure._tag === 'RemoteUnreachable' ? SLACK_UNREACHABLE_PROBLEM : failure.message;

        const logEscalation = (message: string, taskId: string) => (failure: unknown) =>
          Effect.logWarning(message).pipe(Effect.annotateLogs({ taskId, error: describeError(failure) }));

        const followUp = Effect.fn('Slack.followUp')(function* (
          effect: SlackEffect<'slack.escalate'>,
          key: string,
          machineToken: Redacted.Redacted<string>,
          url: string
        ) {
          const state = yield* engine.state;
          const task = state.tasks[effect.taskId];
          const sent = Option.getOrNull(
            selectSlackEscalationPost(task?.slackEscalations, effect.escalatedAt, effect.contact)
          );
          const message = Option.getOrNull(resolveSlackEscalationFollowUp(state, effect.taskId, url));
          if (!task || !message || !sent?.channelId || !sent.ts) return;
          const { contact } = effect;
          const target = { teamId: contact.teamId, kind: contact.kind, id: contact.id, message };
          if (sent.followUpTs) {
            yield* relay
              .notify(machineToken, {
                ...target,
                replace: { channelId: sent.channelId, ts: sent.followUpTs },
                reply: null,
              })
              .pipe(
                Effect.catch(logEscalation('[Slack] The escalation’s follow-up could not be edited', task.id))
              );
            return;
          }
          const posted = yield* relay
            .notify(machineToken, {
              ...target,
              replace: null,
              reply: { channelId: sent.channelId, threadTs: sent.ts },
            })
            .pipe(
              Effect.map((reply) => reply.ts),
              Effect.catch((failure) =>
                failure._tag === 'RemoteUnreachable' && failure.retryable
                  ? Effect.fail(failure)
                  : logEscalation(
                      '[Slack] The escalation’s follow-up could not be posted',
                      task.id
                    )(failure).pipe(Effect.as(null))
              )
            );
          if (posted === null) return;
          yield* dispatch(
            {
              type: 'slack.record_escalation_follow_up',
              taskId: task.id,
              escalatedAt: effect.escalatedAt,
              contact,
              ts: posted,
            },
            `${key}:slack.record_escalation_follow_up`
          );
        });

        const postEscalation = (
          machineToken: Redacted.Redacted<string> | null,
          notify: SlackRelayNotify,
          taskId: string
        ) =>
          machineToken
            ? relay.notify(machineToken, notify).pipe(
                Effect.map((posted) => ({ ...posted, problem: null as string | null })),
                Effect.catch((failure) =>
                  failure._tag === 'RemoteUnreachable' && failure.retryable
                    ? Effect.fail(failure)
                    : logEscalation(
                        '[Slack] The escalation could not be posted',
                        taskId
                      )(failure).pipe(
                        Effect.as({
                          channelId: null as string | null,
                          ts: null as string | null,
                          problem: describeEscalationProblem(failure) as string | null,
                        })
                      )
                )
              )
            : Effect.succeed({ channelId: null, ts: null, problem: SLACK_REMOTE_OFF_PROBLEM });

        const replaceEscalation = (
          machineToken: Redacted.Redacted<string>,
          target: Omit<SlackRelayNotify, 'replace'>,
          sent: SlackEscalationPost,
          taskId: string
        ) =>
          sent.channelId && sent.ts
            ? relay
                .notify(machineToken, { ...target, replace: { channelId: sent.channelId, ts: sent.ts } })
                .pipe(Effect.catch(logEscalation('[Slack] The escalation could not be edited', taskId)))
            : Effect.void;

        const resolveEscalationLink = Effect.fn('Slack.resolveEscalationLink')(function* (taskId: string) {
          const state = yield* engine.state;
          const credentials = yield* input.credentials;
          const url = credentials
            ? resolveSlackEscalationUrl(input.appOrigin, state, taskId, credentials.instanceId)
            : resolveTaskUrl(taskId);
          return { state, url, machineToken: credentials ? token(credentials.machineToken) : null };
        });

        const sendEscalation = Effect.fn('Slack.sendEscalation')(function* (
          effect: SlackEffect<'slack.escalate'>,
          key: string
        ) {
          const { state, url, machineToken } = yield* resolveEscalationLink(effect.taskId);
          const message = Option.getOrNull(
            resolveSlackEscalationMessage(state, effect.taskId, effect.escalatedAt, url)
          );
          const task = state.tasks[effect.taskId];
          if (!task || !message) return;
          const { contact } = effect;
          const sent = Option.getOrNull(
            selectSlackEscalationPost(task.slackEscalations, effect.escalatedAt, contact)
          );
          const target = { teamId: contact.teamId, kind: contact.kind, id: contact.id, message, reply: null };
          if (task.escalation?.at !== effect.escalatedAt) {
            if (machineToken && sent) yield* replaceEscalation(machineToken, target, sent, task.id);
            return;
          }
          if (sent) {
            if (machineToken) yield* replaceEscalation(machineToken, target, sent, task.id);
            return;
          }
          const outcome = yield* postEscalation(machineToken, { ...target, replace: null }, task.id);
          yield* dispatch(
            {
              type: 'slack.record_escalation',
              taskId: task.id,
              escalatedAt: effect.escalatedAt,
              contact,
              channelId: outcome.channelId,
              ts: outcome.ts,
              problem: outcome.problem,
            },
            `${key}:slack.record_escalation`
          );
        });

        const escalate = Effect.fn('Slack.escalate')(function* (
          effect: SlackEffect<'slack.escalate'>,
          key: string
        ) {
          if (effect.part === 'message') return yield* sendEscalation(effect, key);
          const { url, machineToken } = yield* resolveEscalationLink(effect.taskId);
          if (machineToken) yield* followUp(effect, key, machineToken, url);
        });

        const testContact = Effect.fn('Slack.testContact')(function* (contact: AutopilotContact) {
          const credentials = yield* input.credentials;
          if (!credentials) return { sent: false, problem: SLACK_REMOTE_OFF_PROBLEM };
          const now = yield* Clock.currentTimeMillis;
          const message = serializeSlackEscalationTest(`${input.appOrigin}/settings?tab=agents`, now);
          return yield* relay
            .notify(token(credentials.machineToken), {
              teamId: contact.teamId,
              kind: contact.kind,
              id: contact.id,
              message,
              replace: null,
              reply: null,
            })
            .pipe(
              Effect.as<SlackTestOutcome>({ sent: true, problem: null }),
              Effect.catch((failure) =>
                logEscalation(
                  '[Slack] The test could not be sent',
                  contact.id
                )(failure).pipe(
                  Effect.as<SlackTestOutcome>({ sent: false, problem: describeEscalationProblem(failure) })
                )
              )
            );
        });

        const directory = Effect.fn('Slack.directory')(function* (teamId: string) {
          const empty = { teamId, channels: [], people: [] };
          const credentials = yield* input.credentials;
          if (!credentials) return { ...empty, problem: SLACK_REMOTE_OFF_PROBLEM };
          return yield* relay.directory(token(credentials.machineToken), { teamId }).pipe(
            Effect.map((found): SlackDirectoryView => ({ ...found, problem: null })),
            Effect.catch((failure) =>
              Effect.logWarning('[Slack] Could not list the Slack channels and people').pipe(
                Effect.annotateLogs({ teamId, error: describeError(failure) }),
                Effect.as<SlackDirectoryView>({ ...empty, problem: describeEscalationProblem(failure) })
              )
            )
          );
        });

        const status = Effect.fn('Slack.status')(function* (
          effect: SlackEffect<'slack.status'>,
          key: string
        ) {
          const last = (yield* Ref.get(statusAt)).get(effect.taskId);
          const wait =
            last === undefined
              ? 0
              : last + Duration.toMillis(statusInterval) - (yield* Clock.currentTimeMillis);
          if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
          const state = yield* engine.state;
          const task = state.tasks[effect.taskId];
          const link = task?.slack;
          if (!task || !link) return;
          const gates = listSlackStatusGates(state, task.id);
          const message = serializeSlackCard(task, gates, resolveTaskUrl(task.id));
          const shown = JSON.stringify(message);
          const reaction = resolveSlackReaction(task, gates);
          if (
            link.statusTs &&
            (yield* Ref.get(statusShown)).get(task.id) === shown &&
            reaction === link.reaction
          )
            return;
          let ts = yield* send(link, link.statusTs, message);
          if (!ts && link.statusTs) ts = yield* send(link, null, message);
          const sentAt = yield* Clock.currentTimeMillis;
          yield* Ref.update(statusAt, (times) => new Map(times).set(task.id, sentAt));
          if (!ts) return;
          yield* Ref.update(statusShown, (messages) => new Map(messages).set(task.id, shown));
          yield* syncSession(link, task.id, resolveSlackSessionStatus(task, gates));
          yield* applyReaction(link, link.messageTs, reaction, link.reaction);
          if (ts === link.statusTs && reaction === link.reaction) return;
          yield* dispatch(
            { type: 'slack.record_status', taskId: task.id, ts, reaction },
            `${key}:slack.record_status`
          );
        });

        const isViewers = (viewer: string | null) => (link: SlackLink) => {
          if (viewer !== null) return Effect.succeed(link.accountId === viewer);
          return link.accountId === null ? Effect.succeed(true) : input.isOwner(link.accountId);
        };

        const snapshot = Effect.fn('Slack.snapshot')(function* (viewer: string | null) {
          const credentials = yield* input.credentials;
          if (!credentials) {
            const off: SlackSnapshot = { remote: false, connectUrl: null, links: [], problem: null };
            return off;
          }
          const connectUrl = resolveSlackConnectUrl(input.appOrigin, credentials.instanceId);
          runFork(syncWatches(true));
          return yield* relay.links(token(credentials.machineToken)).pipe(
            Effect.andThen((answer) =>
              Effect.map(Effect.filter(answer.links, isViewers(viewer)), (links) => ({
                links,
                othersLinked: answer.links.length - links.length,
              }))
            ),
            Effect.andThen((seen) => Effect.map(engine.state, (state) => ({ ...seen, state }))),
            Effect.map(({ links, othersLinked, state }): SlackSnapshot => ({
              remote: true,
              connectUrl,
              links: links.map((link) => ({
                ...link,
                lastUsedAt: resolveSlackLastUsedAt(state, link),
              })),
              othersLinked,
              problem: null,
            })),
            Effect.catch((failure) =>
              Effect.logWarning('[Slack] Could not read the Slack links').pipe(
                Effect.annotateLogs({ error: describeError(failure) }),
                Effect.as<SlackSnapshot>({
                  remote: true,
                  connectUrl,
                  links: [],
                  problem:
                    'app.shinsa.dev could not be reached, so Shinsa cannot say which Slack accounts are connected.',
                })
              )
            )
          );
        });

        const disconnect = Effect.gen(function* () {
          const credentials = yield* input.credentials;
          if (!credentials)
            return yield* new DomainError({
              code: 'remote_not_paired',
              message: 'Turn on remote access first.',
            });
          yield* relay.unlink(token(credentials.machineToken));
          return yield* snapshot(null);
        });

        const channels = Effect.gen(function* () {
          const credentials = yield* input.credentials;
          if (!credentials)
            return yield* new DomainError({ code: 'slack_not_connected', message: SLACK_NOT_CONNECTED });
          const listed = yield* relay.channels(token(credentials.machineToken)).pipe(
            Effect.mapError(
              (failure) =>
                new DomainError({
                  code: 'slack_unreachable',
                  message: `Shinsa could not list the Slack channels: ${failure.message} Try again in a moment.`,
                })
            )
          );
          yield* syncWatches(true);
          return listed.channels;
        });

        return Slack.of({
          handleEvents,
          handleMessages,
          channels,
          start,
          stop,
          settle: FiberSet.awaitEmpty(deliveries),
          handleInteractions,
          handleTunnel,
          evaluate,
          post,
          merge,
          react,
          escalate,
          directory,
          testContact,
          status,
          snapshot,
          disconnect,
        });
      })
    );
}
