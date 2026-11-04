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
import { BaseCheckouts } from '../../../checks/base/service.ts';
import { resolveSharedCacheEnv } from '../../../checks/caches/paths.ts';
import { serializeCheckOutput } from '../../../checks/evidence.ts';
import { CheckRunner } from '../../../checks/runner/service.ts';
import { CHECK_TIMEOUT_MS, type CheckRun } from '../../../checks/schema.ts';
import { History } from '../../../git/history/service.ts';
import { TaskCoverage } from '../../../test-coverage/service.ts';
import type { EffectAttempt } from '../../engine/schema.ts';
import { resolveEffectFailure } from '../../failures/classify.ts';
import type { EffectFailure } from '../../failures/schema.ts';
import { EditCommits } from '../edits/service.ts';
import type { EffectOf } from '../schema.ts';
import { EffectWorld } from '../world/service.ts';

export class CheckRuns extends Context.Service<
  CheckRuns,
  { run(effect: EffectOf<'checks.run'>, attempt: EffectAttempt): Effect.Effect<void, EffectFailure> }
>()('shinsa/engine/runtime/effects/checks/CheckRuns') {
  static readonly layer = Layer.effect(
    CheckRuns,
    Effect.gen(function* () {
      const world = yield* EffectWorld;
      const edits = yield* EditCommits;
      const runner = yield* CheckRunner;
      const bases = yield* BaseCheckouts;
      const taskCoverage = yield* TaskCoverage;
      const history = yield* History;

      const storeOutputs = Effect.fn('CheckRuns.storeOutputs')(function* (
        task: Task,
        runs: readonly CheckRun[]
      ) {
        const folder = { taskId: task.id, round: resolveCurrentRound(task).number };
        return yield* Effect.forEach(runs, (run) =>
          world.evidence.writeText(serializeCheckOutput(run), folder, run.check.label, 'txt').pipe(
            Effect.map((uri): CheckEvidence => ({ checkId: run.check.id, title: run.check.label, uri })),
            Effect.mapError(resolveEffectFailure)
          )
        );
      });

      const run = Effect.fn('CheckRuns.run')(function* (
        effect: EffectOf<'checks.run'>,
        attempt: EffectAttempt
      ) {
        const { task, repo } = yield* world.findTask(effect.taskId);
        const worktree = task.worktreePath;
        if (task.stage !== 'checking' || !worktree) return;
        yield* world.runs.quiesce(task.id);
        if (task.approvedEdits === 'review') yield* edits.commit(task, repo, attempt);
        const env = resolveSharedCacheEnv(worktree, world.config.dataDir, repo.id);
        const track = world.trackProcess;
        const runSync = Effect.runSyncWith(yield* Effect.context<never>());
        const runs = yield* Effect.acquireUseRelease(
          Effect.sync((): Effect.Effect<void>[] => []),
          (releases) =>
            Effect.flatMap(
              Effect.cached(
                Effect.map(history.taskRefs(repo, task, resolveRoundBase(task)), (refs) => refs.base)
              ),
              (resolveBase) =>
                runner.runAll(effect.checks, worktree, {
                  timeoutMs: CHECK_TIMEOUT_MS,
                  env,
                  compare: (checked) =>
                    bases.compare({
                      repo,
                      resolveBase,
                      cwd: worktree,
                      run: checked,
                      timeoutMs: CHECK_TIMEOUT_MS,
                      env,
                    }),
                  ...(track
                    ? { onSpawn: (pid: number) => releases.push(runSync(track(task.id, 'checks', pid))) }
                    : {}),
                })
            ),
          (releases) => Effect.forEach(releases, (release) => release, { discard: true })
        );
        let coverage: Coverage | null = null;
        if (effect.coverage && !runs.some((checked) => isBlockingCheck(checked.check))) {
          coverage = yield* taskCoverage.measure({
            repo,
            task,
            commands: listTaskChecks(task, repo).map((check) => check.command),
            baseBranch: resolveRoundBase(task),
          });
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
