import { type CheckToRun, describeCount } from '@shinsa/core';
import { Context, Duration, Effect, FileSystem, Layer, Option } from 'effect';
import { resolveCancel } from '../../shell/abort.ts';
import {
  CANCELLED_BEFORE_START,
  CANCELLED_EXIT_CODE,
  type CommandResult,
  NOT_STARTED_EXIT_CODE,
} from '../../shell/schema.ts';
import { Shell } from '../../shell/service.ts';
import { describeFailureDiff, selectCheckFailures } from '../failures.ts';
import {
  describeFailedRun,
  describeRerunOutput,
  joinOutput,
  listRerunPaths,
  selectFailedFiles,
  tailOutput,
} from '../output.ts';
import { isCoverageFloorOnly, isRerunPassed, listFailedTests, selectRerunCommand } from '../reruns.ts';
import {
  CHECK_ENV,
  type CheckFailure,
  type CheckOptions,
  type CheckRoundOptions,
  type CheckRun,
  COVERAGE_FLOOR_ONLY,
  type FailedTestGroup,
  type GroupRerun,
  LOW_PRIORITY,
  NO_TESTS,
} from '../schema.ts';

export class CheckRunner extends Context.Service<
  CheckRunner,
  {
    command(argv: readonly string[], cwd: string, options: CheckOptions): Effect.Effect<CommandResult>;
    run(check: CheckToRun, cwd: string, options: CheckOptions): Effect.Effect<CheckRun>;
    confirm(run: CheckRun, cwd: string, options: CheckOptions): Effect.Effect<CheckRun>;
    runAll(checks: readonly CheckToRun[], cwd: string, options: CheckRoundOptions): Effect.Effect<CheckRun[]>;
  }
>()('shinsa/engine/checks/runner/CheckRunner') {
  static readonly layer = Layer.effect(
    CheckRunner,
    Effect.gen(function* () {
      const shell = yield* Shell;
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
      const prefix = (yield* Effect.sync(() => Bun.which('nice'))) ? LOW_PRIORITY : [];

      const command = Effect.fn('CheckRunner.command')(function* (
        argv: readonly string[],
        cwd: string,
        options: CheckOptions
      ) {
        const { signal, onSpawn } = options;
        if (signal?.aborted) {
          return {
            ok: false,
            code: CANCELLED_EXIT_CODE,
            stdout: '',
            stderr: CANCELLED_BEFORE_START,
            timedOut: false,
          } satisfies CommandResult;
        }
        const [program = 'sh', ...args] = [...prefix, ...argv];
        return yield* shell
          .run({
            argv: [program, ...args],
            cwd,
            env: { ...CHECK_ENV, ...options.env },
            timeout: Duration.millis(options.timeoutMs),
            cancel: resolveCancel(signal),
            onSpawn: onSpawn ? (pid) => Effect.sync(() => onSpawn(pid)) : undefined,
          })
          .pipe(
            Effect.catchTag('CommandNotFound', (missing) =>
              Effect.succeed({
                ok: false,
                code: NOT_STARTED_EXIT_CODE,
                stdout: '',
                stderr: missing.message,
                timedOut: false,
              } satisfies CommandResult)
            )
          );
      });

      const run = Effect.fn('CheckRunner.run')(function* (
        check: CheckToRun,
        cwd: string,
        options: CheckOptions
      ) {
        const result = yield* command(['sh', '-c', check.command], cwd, options);
        const output = joinOutput(result);
        const { id, label } = check;
        const floorOnly = !result.ok && !result.timedOut && isCoverageFloorOnly(output);
        if (result.ok || floorOnly) {
          return {
            check: {
              id,
              label,
              command: check.command,
              outcome: 'pass',
              detail: floorOnly ? COVERAGE_FLOOR_ONLY : null,
            },
            output,
            timedOut: false,
            failedFiles: [],
            failures: [],
          } satisfies CheckRun;
        }
        const failed = {
          check: {
            id,
            label,
            command: check.command,
            outcome: 'fail',
            detail: describeFailedRun(result, output, options.timeoutMs),
          },
          output,
          timedOut: result.timedOut,
        } as const;
        if (result.timedOut) return { ...failed, failedFiles: null, failures: null } satisfies CheckRun;
        const [files, failures] = yield* withFiles(
          Effect.all([selectFailedFiles(output, cwd), selectCheckFailures(output, cwd)])
        );
        return {
          ...failed,
          failedFiles: Option.getOrNull(files),
          failures: Option.getOrNull(failures),
        } satisfies CheckRun;
      });

      const rerunGroups = Effect.fn('CheckRunner.rerunGroups')(function* (
        groups: readonly FailedTestGroup[],
        cwd: string,
        options: CheckOptions
      ) {
        const commands = yield* Effect.forEach(groups, (group) =>
          Effect.map(withFiles(selectRerunCommand(group, cwd)), (argv) => ({ group, argv }))
        );
        const reruns: GroupRerun[] = [];
        for (const { group, argv } of commands) {
          if (Option.isNone(argv)) return null;
          const result = yield* command(argv.value, group.packageDir, options);
          if (options.signal?.aborted) return null;
          const output = joinOutput(result);
          reruns.push({ group, passed: isRerunPassed(group.runner, output, result.ok), output });
        }
        return reruns;
      });

      const confirm = Effect.fn('CheckRunner.confirm')(function* (
        checked: CheckRun,
        cwd: string,
        options: CheckOptions
      ) {
        if (checked.check.outcome !== 'fail' || checked.timedOut) return checked;
        const failed = yield* withFiles(listFailedTests(checked.output, cwd));
        if (failed.kind !== 'files') return checked;
        const reruns = yield* rerunGroups(failed.groups, cwd, options);
        if (!reruns) return checked;
        const output = `${checked.output}\n\nRe-run alone:\n${describeRerunOutput(reruns)}`;
        const failing = reruns.filter((rerun) => !rerun.passed);
        const passing = listRerunPaths(
          reruns.filter((rerun) => rerun.passed),
          cwd
        );
        if (failing.length === 0) {
          const files = describeCount(passing.length, 'test file');
          const detail = `${files} failed in the full run and passed when re-run alone: ${passing.join(', ')}.`;
          return {
            ...checked,
            check: { ...checked.check, outcome: 'pass', detail, note: 'passed_alone' },
            output,
          } satisfies CheckRun;
        }
        const failedFiles = listRerunPaths(failing, cwd);
        const lines = [
          `Failed again when re-run alone: ${failedFiles.join(', ')}.`,
          passing.length > 0 ? `Passed when re-run alone: ${passing.join(', ')}.` : '',
          tailOutput(describeRerunOutput(failing)),
        ];
        const detail = lines.filter((line) => line.length > 0).join('\n');
        const kept = (failure: CheckFailure) => failure.kind !== 'test' || failedFiles.includes(failure.file);
        const failures = checked.failures?.filter(kept) ?? null;
        return {
          ...checked,
          check: { ...checked.check, detail },
          output,
          failedFiles,
          failures,
        } satisfies CheckRun;
      });

      const compareOnBase = Effect.fn('CheckRunner.compareOnBase')(function* (
        checked: CheckRun,
        options: CheckRoundOptions
      ) {
        const { compare } = options;
        if (checked.check.outcome !== 'fail' || checked.timedOut || !compare || options.signal?.aborted)
          return checked;
        if (NO_TESTS.test(checked.output)) return checked;
        const diff = yield* compare(checked);
        if (!diff) return checked;
        const detail = [describeFailureDiff(diff), checked.check.detail].filter(Boolean).join('\n\n');
        if (diff.added.length > 0)
          return { ...checked, check: { ...checked.check, detail } } satisfies CheckRun;
        return { ...checked, check: { ...checked.check, detail, note: 'fails_on_base' } } satisfies CheckRun;
      });

      const runAll = Effect.fn('CheckRunner.runAll')(function* (
        checks: readonly CheckToRun[],
        cwd: string,
        options: CheckRoundOptions
      ) {
        const byCommand = new Map<string, Effect.Effect<CheckRun>>();
        const pending: { check: CheckToRun; checked: Effect.Effect<CheckRun> }[] = [];
        for (const check of checks) {
          const known = byCommand.get(check.command);
          const checked =
            known ??
            (yield* Effect.cached(
              run(check, cwd, options).pipe(
                Effect.flatMap((each) => confirm(each, cwd, options)),
                Effect.flatMap((each) => compareOnBase(each, options))
              )
            ));
          byCommand.set(check.command, checked);
          pending.push({ check, checked });
        }
        return yield* Effect.forEach(
          pending,
          ({ check, checked }) =>
            Effect.map(checked, (each) => ({
              ...each,
              check: { ...each.check, id: check.id, label: check.label },
            })),
          { concurrency: 'unbounded' }
        );
      });

      return CheckRunner.of({ command, run, confirm, runAll });
    })
  );
}
