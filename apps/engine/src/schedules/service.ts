import { DomainError } from '@shinsa/core';
import { Context, Effect, Layer, Ref } from 'effect';
import { EngineCore } from '../runtime/engine/service.ts';
import { SecretStore } from '../secrets/index.ts';
import { type SurfaceHookSecrets, SurfaceCallFailed } from '../surface/schema.ts';
import { ScheduleClock } from './clock/service.ts';
import type { ScheduleToolCall } from './schema.ts';
import { type ScheduleToolFailure, ScheduleToolRefused } from './tools/schema.ts';
import { ScheduleTools } from './tools/service.ts';
import { WebhookReceiver } from './webhook/service.ts';

export class Schedules extends Context.Service<
  Schedules,
  {
    readonly start: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly fireDue: Effect.Effect<void>;
    readonly handleWebhook: (request: Request, url: URL) => Effect.Effect<Response>;
    readonly upsertHookUrl: (scheduleId: string) => Effect.Effect<string>;
    readonly hookSecrets: (taskId: string) => SurfaceHookSecrets;
    readonly handleTool: (
      name: string,
      input: Record<string, unknown>,
      call: ScheduleToolCall
    ) => Effect.Effect<string, ScheduleToolFailure> | null;
  }
>()('shinsa/engine/schedules/Schedules') {
  static readonly layer = Layer.effect(
    Schedules,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const secrets = yield* SecretStore;
      const clock = yield* ScheduleClock;
      const receiver = yield* WebhookReceiver;
      const tools = yield* ScheduleTools;
      const active = yield* Ref.make(false);

      const syncHooks = Effect.gen(function* () {
        const schedules = Object.values((yield* engine.state).schedules);
        const webhooks = schedules.filter((schedule) => schedule.trigger.kind === 'webhook');
        yield* Effect.forEach(webhooks, (schedule) => secrets.upsertHook(schedule.id), { discard: true });
        yield* secrets.pruneHooks(new Set(schedules.map((schedule) => schedule.id)));
      });

      const runFork = Effect.runForkWith(yield* Effect.context<never>());
      yield* engine.observe(() => {
        runFork(Effect.when(syncHooks, Ref.get(active)));
      });

      const start = Effect.gen(function* () {
        yield* secrets.removeExpiredRefs;
        yield* syncHooks;
        yield* Ref.set(active, true);
        yield* clock.start;
      });

      const stop = Effect.andThen(Ref.set(active, false), clock.stop);

      const hookSecrets = (taskId: string): SurfaceHookSecrets => ({
        assertSecret: (scheduleId, ref) =>
          Effect.mapError(
            tools.assertSigningSecret(scheduleId, ref, 'signature_secret_ref'),
            (failure) => new SurfaceCallFailed({ message: failure.message })
          ),
        writeSecret: (scheduleId, ref) =>
          Effect.flatMap(engine.state, (state) => tools.writeScheduleSecret(state, scheduleId, ref, taskId)),
      });

      const handleTool = (name: string, input: Record<string, unknown>, call: ScheduleToolCall) =>
        tools.handle(name, input, {
          runId: call.runId,
          attemptId: call.attemptId,
          state: engine.state,
          dispatch: (command) =>
            Effect.mapError(call.dispatch(command), (failure) =>
              failure instanceof DomainError ? failure : new ScheduleToolRefused({ message: failure.message })
            ),
        });

      return Schedules.of({
        start,
        stop,
        fireDue: clock.fireDue,
        handleWebhook: receiver.handle,
        upsertHookUrl: tools.upsertHookUrl,
        hookSecrets,
        handleTool,
      });
    })
  );
}
