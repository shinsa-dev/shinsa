import {
  type CheckEvidence,
  type Coverage,
  isBlockingCheck,
  listTaskChecks,
  resolveCurrentRound,
  resolveRoundBase,
  type Task,
} from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { resolveSharedCacheEnv } from '../../../checks/caches.ts';
import { serializeCheckOutput } from '../../../checks/evidence.ts';
import { CHECK_TIMEOUT_MS, type CheckRun, runChecks } from '../../../checks/index.ts';
import { measureTaskCoverage } from '../../../test-coverage/index.ts';
import type { EffectAttempt } from '../../engine/schema.ts';
import { resolveEffectFailure } from '../../failures/classify.ts';
import type { EffectFailure } from '../../failures/schema.ts';
import { EditCommits } from '../edits/service.ts';
import type { EffectOf } from '../schema.ts';
import { EffectWorld } from '../world/service.ts';
import { createBaseComparison } from './comparison.ts';

export class CheckRuns extends Context.Service<
  CheckRuns,
  { run(effect: EffectOf<'checks.run'>, attempt: EffectAttempt): Effect.Effect<void, EffectFailure> }
>()('shinsa/engine/runtime/effects/checks/CheckRuns') {
  static readonly layer = Layer.effect(
    CheckRuns,
    Effect.gen(function* () {
      const world = yield* EffectWorld;
      const edits = yield* EditCommits;

      const storeOutputs = Effect.fn('CheckRuns.storeOutputs')(function* (
        task: Task,
        runs: readonly CheckRun[]
      ) {
        const folder = { taskId: task.id, round: resolveCurrentRound(task).number };
        return yield* Effect.try({
          try: () =>
            runs.map((run): CheckEvidence => ({
              checkId: run.check.id,
              title: run.check.label,
              uri: world.evidence.writeText(serializeCheckOutput(run), folder, run.check.label),
            })),
          catch: resolveEffectFailure,
        });
      });

      const run = Effect.fn('CheckRuns.run')(function* (
        effect: EffectOf<'checks.run'>,
        attempt: EffectAttempt
      ) {
        const { task, repo } = yield* world.findTask(effect.taskId);
        const worktree = task.worktreePath;
        if (task.stage !== 'checking' || !worktree) return;
        yield* world.bridge(() => world.runs.quiesce(task.id));
        if (task.approvedEdits === 'review') yield* edits.commit(task, repo, attempt);
        const env = resolveSharedCacheEnv(worktree, world.config.dataDir, repo.id);
        const track = world.trackProcess;
        const runs = yield* Effect.acquireUseRelease(
          Effect.sync((): (() => void)[] => []),
          (releases) =>
            world.bridge((signal) =>
              runChecks(effect.checks, worktree, {
                timeoutMs: CHECK_TIMEOUT_MS,
                signal,
                env,
                compare: createBaseComparison(world.bases, task, repo, worktree, env, signal),
                ...(track ? { onSpawn: (pid: number) => releases.push(track(task.id, 'checks', pid)) } : {}),
              })
            ),
          (releases) =>
            Effect.sync(() => {
              for (const release of releases) release();
            })
        );
        let coverage: Coverage | null = null;
        if (effect.coverage && !runs.some((checked) => isBlockingCheck(checked.check))) {
          coverage = yield* world.bridge((signal) =>
            measureTaskCoverage({
              repo,
              task,
              commands: listTaskChecks(task, repo).map((check) => check.command),
              baseBranch: resolveRoundBase(task),
              signal,
            })
          );
        }
        if (coverage?.status === 'unavailable') {
          yield* Effect.logWarning('[Coverage] Could not measure the changed lines').pipe(
            Effect.annotateLogs({ taskId: task.id, reason: coverage.reason })
          );
        }
        yield* world.dispatch(
          {
            type: 'checks.record',
            taskId: task.id,
            results: runs.map((checked) => checked.check),
            outputs: yield* storeOutputs(task, runs),
            ...(coverage ? { coverage } : {}),
          },
          { id: `${attempt.key}:checks.record` }
        );
      });

      return CheckRuns.of({ run });
    })
  );
}
