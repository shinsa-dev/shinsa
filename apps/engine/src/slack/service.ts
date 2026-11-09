import {
  DomainError,
  listSlackStatusGates,
  parseSlackDecision,
  parseSlackEvaluation,
  parseSlackMention,
  resolveSlackConnectUrl,
  resolveSlackPostMessage,
  resolveSlackReaction,
  resolveSlackSessionStatus,
  resolveSlackLastUsedAt,
  resolveSlackMergeMessage,
  resolveSlackTaskUrl,
  resolveSlackThreadKey,
  SLACK_ENGINE_INTERACTIONS_PATH,
  SLACK_EVALUATION_SCHEMA,
  SLACK_EVALUATION_SYSTEM,
  SLACK_FORWARD_HEADERS,
  SLACK_REACTIONS,
  type SlackDecisionReply,
  type SlackMessage,
  type SlackSessionStatus,
  type SlackSnapshot,
  type ShinsaCommand,
  type TaskOwner,
  type SlackThreadRef,
  serializeSlackCard,
  serializeSlackDeclined,
  serializeSlackEvaluationPrompt,
  serializeSlackNoAccess,
  verifySlackForwardSignature,
} from '@shinsa/core';
import { serializeRemoteFailure } from '@shinsa/core/remote/errors';
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Ref, Schema } from 'effect';
import { QuickCalls } from '../agents/quick/service.ts';
import { describeError } from '../log/redact.ts';
import { RELAY_FAILED_CODE } from '../remote/client/schema.ts';
import { RemoteClient } from '../remote/client/service.ts';
import { EngineCore } from '../runtime/engine/service.ts';
import {
  SLACK_EVENT_BODY_LIMIT_BYTES,
  SlackBodyText,
  type SlackEffect,
  type SlackInput,
  type SlackLinksFailure,
  type SlackRefusal,
  type SlackRelayFailure,
  SlackRequestUnreadable,
  SlackStatusInterval,
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
    readonly status: (
      effect: SlackEffect<'slack.status'>,
      key: string
    ) => Effect.Effect<void, SlackRefusal | SlackRelayFailure>;
    readonly snapshot: Effect.Effect<SlackSnapshot>;
    readonly disconnect: Effect.Effect<SlackSnapshot, SlackLinksFailure>;
  }
>()('shinsa/engine/slack/Slack') {
  static readonly layer = (input: SlackInput) =>
    Layer.effect(
      Slack,
      Effect.gen(function* () {
        const engine = yield* EngineCore;
        const quick = yield* QuickCalls;
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
          const mention = parseSlackMention(read.value);
          if (!mention) return respondJsonError('body_invalid', 'The mention is missing a part.', 400);
          yield* dispatch({ type: 'slack.mention', mention }, `slack:${mention.eventId}`);
          return Response.json({ ok: true }, { status: 202 });
        });

        const handleInteractions = Effect.fn('Slack.handleInteractions')(function* (request: Request) {
          const read = yield* readSigned(request);
          if (read instanceof Response) return read;
          const decision = parseSlackDecision(read.value);
          if (!decision) return respondJsonError('body_invalid', 'The decision is missing a part.', 400);
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

        const handleTunnel = (request: Request, url: URL) =>
          url.pathname === SLACK_ENGINE_INTERACTIONS_PATH
            ? handleInteractions(request)
            : handleEvents(request);

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
          if (parseSlackEvaluation(said) === 'none') {
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
          if (!message) return;
          yield* send(effect.thread, null, message);
        });

        const merge = Effect.fn('Slack.merge')(function* (effect: SlackEffect<'slack.merge'>, key: string) {
          const state = yield* engine.state;
          const message = resolveSlackMergeMessage(
            state,
            effect.taskId,
            effect.round,
            resolveTaskUrl(effect.taskId)
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

        const snapshot = Effect.gen(function* () {
          const credentials = yield* input.credentials;
          if (!credentials) {
            const off: SlackSnapshot = { remote: false, connectUrl: null, links: [], problem: null };
            return off;
          }
          const connectUrl = resolveSlackConnectUrl(input.appOrigin, credentials.instanceId);
          return yield* relay.links(token(credentials.machineToken)).pipe(
            Effect.andThen((answer) => Effect.map(engine.state, (state) => ({ answer, state }))),
            Effect.map(({ answer, state }): SlackSnapshot => ({
              remote: true,
              connectUrl,
              links: answer.links.map((link) => ({
                ...link,
                lastUsedAt: resolveSlackLastUsedAt(state, link),
              })),
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
          return yield* snapshot;
        });

        return Slack.of({
          handleEvents,
          handleInteractions,
          handleTunnel,
          evaluate,
          post,
          merge,
          react,
          status,
          snapshot,
          disconnect,
        });
      })
    );
}
