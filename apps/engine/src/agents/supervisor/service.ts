import { Context, Deferred, Effect, Layer, Option } from 'effect';
import { Extensions } from '../../extensions/registry/service.ts';
import { describeError } from '../../log/index.ts';
import { ProcessLedger } from '../../resources/index.ts';
import { Evidence } from '../../store/evidence/service.ts';
import type { ActiveRun } from '../active/schema.ts';
import { LiveRuns } from '../active/service.ts';
import { CompactionFailed, IdleCompactor } from '../compaction/schema.ts';
import { IdleCompaction } from '../compaction/service.ts';
import { Deliveries } from '../deliveries/service.ts';
import { SessionExtensionSets } from '../extension-sets/service.ts';
import { ManageAccess } from '../manage/index.ts';
import { Questions } from '../questions/service.ts';
import { ToolCallsLayer } from '../tool-calls/layers.ts';
import { ToolCalls } from '../tool-calls/service.ts';
import { compactSession } from './compact.ts';
import {
  cancelRun,
  holdNewRuns,
  isRunHeld,
  recoverRuns,
  releaseHeld,
  runToEnd,
  shutdownRuns,
  steerRun,
} from './control.ts';
import { RunHost } from './host/service.ts';
import { RunHooks, RunLimits, type RunSupervisorShape } from './schema.ts';
import { listServerNames } from './session.ts';
import { quiesceTask } from './stop.ts';
import { RunWorld } from './world/service.ts';

export class RunSupervisor extends Context.Service<RunSupervisor, RunSupervisorShape>()(
  'shinsa/engine/agents/supervisor/RunSupervisor'
) {
  static readonly layer = Layer.effect(
    RunSupervisor,
    Effect.gen(function* () {
      const limits = yield* RunLimits;
      const hooks = yield* RunHooks;
      const extensions = yield* Effect.serviceOption(Extensions);
      const ledger = yield* Effect.serviceOption(ProcessLedger);
      const manage = yield* Effect.serviceOption(ManageAccess);
      const evidence = yield* Evidence;
      const extensionSets = yield* SessionExtensionSets;
      const ready = yield* Deferred.make<Context.Context<RunWorld | RunHost>>();
      const within = <A, E>(effect: Effect.Effect<A, E, RunWorld | RunHost>) =>
        Deferred.await(ready).pipe(Effect.flatMap((services) => Effect.provide(effect, services)));
      const active = new Map<string, ActiveRun>();
      const live = LiveRuns.of({
        active,
        execute: (runId, prompt, delivery) => within(runToEnd(runId, prompt, delivery)).pipe(Effect.orDie),
        listServerNames: (run) => within(listServerNames(run)),
      });
      const compactor = IdleCompactor.of((runId, sessionId) =>
        within(compactSession(runId, sessionId)).pipe(
          Effect.mapError((error) => new CompactionFailed({ message: describeError(error) })),
          Effect.catchDefect((defect) =>
            Effect.fail(new CompactionFailed({ message: describeError(defect) }))
          )
        )
      );
      const parts = yield* Layer.build(
        Layer.merge(ToolCallsLayer, IdleCompaction.layer).pipe(
          Layer.provide(Layer.merge(Layer.succeed(LiveRuns, live), Layer.succeed(IdleCompactor, compactor)))
        )
      );
      const questions = Context.get(parts, Questions);
      const deliveries = Context.get(parts, Deliveries);
      const host = RunHost.layer({
        active,
        questions,
        deliveries,
        compaction: Context.get(parts, IdleCompaction),
        tools: Context.get(parts, ToolCalls),
        extensionSets,
        evidence,
        limits,
        hooks: {
          ...hooks,
          trackProcess: Option.isSome(ledger) ? ledger.value.track : null,
          extensions: Option.getOrNull(extensions),
          manages: Option.isSome(manage),
        },
      });
      const built = yield* Layer.build(Layer.mergeAll(RunWorld.layer, host));
      const services = Context.merge(yield* Effect.context<never>(), built);
      yield* Deferred.succeed(ready, services);
      const provide = <A, E>(effect: Effect.Effect<A, E, RunWorld | RunHost>) =>
        Effect.provide(effect, services);
      return RunSupervisor.of({
        execute: (runId, override, delivery) => provide(runToEnd(runId, override, delivery)),
        quiesce: (taskId, except) => provide(quiesceTask(taskId, except)),
        steer: (runId, text, cause, from) => provide(steerRun(runId, text, cause, from)),
        cancel: (runId) => provide(cancelRun(runId)),
        holdNewRuns: (onHeld) => provide(holdNewRuns(onHeld)),
        releaseHeldRuns: provide(releaseHeld()),
        isHeld: (runId) => provide(isRunHeld(runId)),
        interruptForShutdown: provide(shutdownRuns()),
        recover: provide(recoverRuns()),
        resolveQuestion: questions.resolve,
        replyToDelegate: questions.replyToDelegate,
        deliver: deliveries.deliver,
        wake: deliveries.wake,
      });
    })
  );
}
