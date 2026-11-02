import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed, RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Predicate } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { findHookUrl } from '../../../schedules/tools.ts';
import { requestPromise, requestSync } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';
import { GATE_CLOSED, MAX_SECRET, NO_SECRET_GATE, NO_WEBHOOK, SECRET_INVALID } from './schema.ts';

export const SecretsHandlers = HttpApiBuilder.group(
  EngineApi,
  'secrets',
  Effect.fn('SecretsHandlers')(function* (handlers) {
    const { engine, schedules } = yield* HttpServices;

    const findSchedules = schedules
      ? Effect.succeed(schedules.context)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    const readSecret = (value: unknown) =>
      Predicate.isString(value) && value.length > 0 && value.length <= MAX_SECRET
        ? Effect.succeed(value)
        : Effect.fail(new RequestFailed(SECRET_INVALID));

    const findWebhook = Effect.fn('SecretsHandlers.findWebhook')(function* (scheduleId: string) {
      const context = yield* findSchedules;
      const schedule = engine.state.schedules[scheduleId];
      if (schedule?.trigger.kind !== 'webhook') return yield* new RequestFailed(NO_WEBHOOK);
      return { context, trigger: schedule.trigger };
    });

    const serializeWebhook = Effect.fn('SecretsHandlers.serializeWebhook')(function* (scheduleId: string) {
      const { context, trigger } = yield* findWebhook(scheduleId);
      return {
        url: yield* requestSync(() => findHookUrl(context, scheduleId)),
        signature: trigger.signature,
        hasSecret: Boolean(context.secrets.selectHook(scheduleId)?.secret),
        replayKey: trigger.replayKey,
      };
    });

    const findSecretGate = Effect.fn('SecretsHandlers.findSecretGate')(function* (gateId: string) {
      const context = yield* findSchedules;
      const gate = engine.state.gates[gateId];
      if (!gate?.secret) return yield* new RequestFailed(NO_SECRET_GATE);
      if (gate.status !== 'open') return yield* new RequestFailed(GATE_CLOSED);
      return { gate, secrets: context.secrets };
    });

    return handlers
      .handle('webhook', ({ params }) => serializeWebhook(params.scheduleId))
      .handle(
        'writeWebhookSecret',
        Effect.fn('SecretsHandlers.writeWebhookSecret')(function* ({ params, payload }) {
          const { context } = yield* findWebhook(params.scheduleId);
          const secret = payload.secret === null ? null : yield* readSecret(payload.secret);
          context.secrets.writeHookSecret(params.scheduleId, secret);
          return yield* serializeWebhook(params.scheduleId);
        })
      )
      .handle(
        'answer',
        Effect.fn('SecretsHandlers.answer')(function* ({ params, payload }) {
          const { gateId } = params;
          const { gate, secrets } = yield* findSecretGate(gateId);
          if (payload.decline === true) {
            yield* requestPromise(() =>
              engine.dispatch(
                { type: 'gate.answer', gateId, decision: 'reject', response: null },
                { id: `secret:${gateId}:declined` }
              )
            );
            return { ok: true as const };
          }
          const value = yield* readSecret(payload.value);
          const ref = secrets.writeRef(gateId, gate.taskId, value);
          yield* requestPromise(() =>
            engine.dispatch(
              { type: 'gate.answer', gateId, decision: 'reply', response: ref },
              { id: `secret:${gateId}:saved` }
            )
          ).pipe(Effect.tapError(() => Effect.sync(() => secrets.removeRef(ref, gate.taskId))));
          return { ok: true as const };
        })
      );
  })
);
