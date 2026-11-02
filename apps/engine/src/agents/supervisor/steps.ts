import type { DelegatedRun, Repo, RunUsage, WeeklyReading } from '@shinsa/core';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { JsonLogger } from '../../log/service.ts';
import type { ActiveRun } from '../active/schema.ts';
import type { AgentSessionResult } from '../providers/index.ts';
import type { TurnPlan } from '../turns/schema.ts';
import { recordAttempt, resolveModel } from './attempts.ts';
import { meter, meterAttempt } from './meter.ts';
import { isOverloadRetry, waitForOverload } from './overload.ts';
import type { Turn, Workspace } from './schema.ts';
import { prepareIsolation, prepareWorkspace } from './workspace.ts';
import { RunWorld } from './world/service.ts';

export class RunSteps {
  readonly #runtime: ManagedRuntime.ManagedRuntime<RunWorld, never>;

  constructor(world: Parameters<typeof RunWorld.layer>[0]) {
    this.#runtime = ManagedRuntime.make(Layer.mergeAll(RunWorld.layer(world), JsonLogger));
  }

  prepareWorkspace(workspace: Workspace) {
    return this.#runtime.runPromise(prepareWorkspace(workspace));
  }

  prepareIsolation(run: DelegatedRun, repo: Repo | null) {
    return this.#runtime.runPromise(
      prepareIsolation(run, repo).pipe(
        Effect.as(null),
        Effect.catchTag('IsolationFailed', (failure) => Effect.succeed(failure.message))
      )
    );
  }

  isOverloadRetry(active: ActiveRun, result: AgentSessionResult, shuttingDown: boolean) {
    return this.#runtime.runPromise(isOverloadRetry(active, result, shuttingDown));
  }

  waitForOverload(turn: Turn, detail: string) {
    return this.#runtime.runPromise(waitForOverload(turn, detail));
  }

  recordAttempt(turn: Turn, plan: TurnPlan) {
    return this.#runtime.runPromise(recordAttempt(turn, plan));
  }

  resolveModel(turn: Turn) {
    return this.#runtime.runPromise(resolveModel(turn));
  }

  meterAttempt(
    turn: Turn,
    attemptId: string,
    sessionId: string | null,
    result: AgentSessionResult,
    weeklyBefore: Promise<WeeklyReading | null>
  ) {
    return this.#runtime.runPromise(meterAttempt(turn, attemptId, sessionId, result, weeklyBefore));
  }

  meter(runId: string, sessionId: string | null, usage: RunUsage, id: string) {
    return this.#runtime.runPromise(meter(runId, sessionId, usage, id));
  }
}
