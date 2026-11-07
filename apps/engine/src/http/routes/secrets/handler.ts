import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed, RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Option, Predicate } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { Schedules } from '../../../schedules/service.ts';
import { SecretStore } from '../../../secrets/store/service.ts';
import { resolveRequestFailure } from '../../failures.ts';
import { GATE_CLOSED, MAX_SECRET, NO_SECRET_GATE, NO_WEBHOOK, SECRET_INVALID } from './schema.ts';

export const SecretsHandlers = HttpApiBuilder.group(
  EngineApi,
  'secrets',
  Effect.fn('SecretsHandlers')(function* (handlers) {
    const engine = yield* EngineCore;
    const schedules = Option.getOrUndefined(yield* Effect.serviceOption(Schedules));
    const store = Option.getOrUndefined(yield* Effect.serviceOption(SecretStore));

    const findSchedules =
      schedules && store
        ? Effect.succeed({ schedules, secrets: store })
        : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    const readSecret = (value: unknown) =>
      Predicate.isString(value) && value.length > 0 && value.length <= MAX_SECRET
        ? Effect.succeed(value)
        : Effect.fail(new RequestFailed(SECRET_INVALID));

    const findWebhook = Effect.fn('SecretsHandlers.findWebhook')(function* (scheduleId: string) {
      const context = yield* findSchedules;
      const schedule = (yield* engine.state).schedules[scheduleId];
      if (schedule?.trigger.kind !== 'webhook') return yield* new RequestFailed(NO_WEBHOOK);
      return { context, trigger: schedule.trigger };
    });

    const serializeWebhook = Effect.fn('SecretsHandlers.serializeWebhook')(function* (scheduleId: string) {
      const { context, trigger } = yield* findWebhook(scheduleId);
      return {
        url: yield* context.schedules.upsertHookUrl(scheduleId),
        signature: trigger.signature,
        hasSecret: Boolean((yield* context.secrets.selectHook(scheduleId))?.secret),
        replayKey: trigger.replayKey,
      };
    });

    const findSecretGate = Effect.fn('SecretsHandlers.findSecretGate')(function* (gateId: string) {
      const context = yield* findSchedules;
      const gate = (yield* engine.state).gates[gateId];
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
          yield* context.secrets.writeHookSecret(params.scheduleId, secret);
          return yield* serializeWebhook(params.scheduleId);
        })
      )
      .handle(
        'answer',
        Effect.fn('SecretsHandlers.answer')(function* ({ params, payload }) {
          const { gateId } = params;
          const { gate, secrets } = yield* findSecretGate(gateId);
          if (payload.decline === true) {
            yield* Effect.mapError(
              engine.dispatch(
                { type: 'gate.answer', gateId, decision: 'reject', response: null },
                { id: `secret:${gateId}:declined` }
              ),
              resolveRequestFailure
            );
            return { ok: true as const };
          }
          const value = yield* readSecret(payload.value);
          const ref = yield* secrets.writeRef(gateId, gate.taskId, value);
          yield* Effect.mapError(
            engine.dispatch(
              { type: 'gate.answer', gateId, decision: 'reply', response: ref },
              { id: `secret:${gateId}:saved` }
            ),
            resolveRequestFailure
          ).pipe(Effect.tapError(() => Effect.ignore(secrets.removeRef(ref, gate.taskId))));
          return { ok: true as const };
        })
      );
  })
);
