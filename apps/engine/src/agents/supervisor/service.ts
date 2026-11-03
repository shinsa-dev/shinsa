import { type ChatEvent, MINUTE_MS } from '@shinsa/core';
import { Context, Deferred, Effect, Layer } from 'effect';
import { AccountLeasing } from '../accounts.ts';
import type { ActiveRun } from '../active/schema.ts';
import { IdleCompaction } from '../compaction.ts';
import type { Delivery } from '../delegations/schema.ts';
import { Deliveries } from '../deliveries.ts';
import { SessionExtensionSets } from '../extension-sets.ts';
import { ProviderRegistry } from '../providers/index.ts';
import { Questions } from '../questions.ts';
import { ToolCalls } from '../tool-calls.ts';
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
import { MAX_RUN_MS, QUIESCE_MS, type RunSupervisorShape, STOP_MS, type SupervisorInput } from './schema.ts';
import { listServerNames } from './session.ts';
import { quiesceTask } from './stop.ts';
import { RunWorld } from './world/service.ts';

export class RunSupervisor extends Context.Service<RunSupervisor, RunSupervisorShape>()(
  'shinsa/engine/agents/supervisor/RunSupervisor'
) {
  static layer({ engine, config, transcripts, evidence, workspaces, options }: SupervisorInput) {
    return Layer.effect(
      RunSupervisor,
      Effect.gen(function* () {
        const ready = yield* Deferred.make<Context.Context<RunWorld | RunHost>>();
        const within = <A, E>(effect: Effect.Effect<A, E, RunWorld | RunHost>) =>
          Effect.runPromise(
            Deferred.await(ready).pipe(Effect.flatMap((services) => Effect.provide(effect, services)))
          );
        const execute = (runId: string, override: string | null = null, delivery: Delivery | null = null) =>
          within(runToEnd(runId, override, delivery));
        const active = new Map<string, ActiveRun>();
        const providers = options.providers ?? new ProviderRegistry();
        const leasing = new AccountLeasing(options.accounts ?? null, () => engine.state, transcripts);
        const questions = new Questions({ engine, transcripts, active, execute, idle: options.idle });
        const tools = new ToolCalls({
          engine,
          evidence,
          transcripts,
          providers,
          questions,
          schedules: options.schedules ?? null,
          minuteMs: options.minuteMs ?? MINUTE_MS,
          manage: options.manage ?? null,
          workspaces,
          services: options.services ?? null,
          listServerNames: (run) => within(listServerNames(run)),
        });
        const deliveries = new Deliveries({ engine, transcripts, active, execute });
        const compaction = new IdleCompaction(
          () => engine.state,
          (runId, sessionId, signal) => within(compactSession(runId, sessionId, signal)),
          options.compaction
        );
        const onNotice = options.onNotice ?? null;
        const recordEntry = (runId: string, entry: ChatEvent) => {
          transcripts.record(runId, entry);
          if (entry.type === 'notice') onNotice?.(runId, entry.notice);
        };
        const world = RunWorld.layer({ engine, config, transcripts, providers, leasing, recordEntry });
        const host = RunHost.layer({
          active,
          questions,
          deliveries,
          compaction,
          tools,
          extensionSets: new SessionExtensionSets(transcripts, () => engine.state),
          evidence,
          limits: {
            maxRunMs: options.maxRunMs ?? MAX_RUN_MS,
            clockTimers: options.clockTimers,
            quiesceMs: options.quiesceMs ?? QUIESCE_MS,
            stopMs: options.stopMs ?? STOP_MS,
          },
          hooks: {
            startSession: options.startSession ?? null,
            onRejection: options.onRejection ?? null,
            onNotice,
            trackProcess: options.trackProcess ?? null,
            extensions: options.extensions ?? null,
            manages: options.manage !== undefined,
          },
        });
        const outer = yield* Effect.context<never>();
        const built = yield* Layer.build(Layer.mergeAll(world, host));
        const services = Context.merge(outer, built);
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
          resolveQuestion: (gateId) => Effect.promise(() => questions.resolve(gateId)),
          replyToDelegate: (runId, questionId) =>
            Effect.promise(() => questions.replyToDelegate(runId, questionId)),
          deliver: (runId, generation) => Effect.promise(() => deliveries.deliver(runId, generation)),
          wake: (runId, generation) => Effect.promise(() => deliveries.wake(runId, generation)),
        });
      })
    );
  }
}
