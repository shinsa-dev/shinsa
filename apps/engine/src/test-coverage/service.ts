import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import {
  COVERAGE_LIMITS,
  type Coverage,
  type CoverageHits,
  measureCoverage,
  parseChangedLines,
  parseCoverageReport,
  resolveCustomFormat,
  resolveRepoCoverage,
} from '@shinsa/core';
import { Context, Effect, FileSystem, Layer, Option } from 'effect';
import { CheckRunner } from '../checks/runner/service.ts';
import { CHECK_TIMEOUT_MS } from '../checks/schema.ts';
import { History } from '../git/history/service.ts';
import { describeError } from '../log/redact.ts';
import { resolveCoverageRun, selectGoModule } from './detect.ts';
import {
  COVERAGE_DIR_PREFIX,
  type CoverageRequest,
  CoverageReportUnreadable,
  type CoverageRun,
  NO_BASE_COMMIT,
  type RunChoice,
} from './schema.ts';

export class TaskCoverage extends Context.Service<
  TaskCoverage,
  { measure(request: CoverageRequest): Effect.Effect<Coverage | null> }
>()('shinsa/engine/test-coverage/TaskCoverage') {
  static readonly layer = Layer.effect(
    TaskCoverage,
    Effect.gen(function* () {
      const runner = yield* CheckRunner;
      const history = yield* History;
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);

      const resolveUnavailable = (command: string, reason: string): Coverage => ({
        status: 'unavailable',
        command: command.slice(0, COVERAGE_LIMITS.command),
        reason: reason.slice(0, COVERAGE_LIMITS.reason),
      });

      const listTestRuns = (commands: readonly string[], worktree: string, dir: string) => {
        const runs: CoverageRun[] = [];
        for (const command of new Set(commands)) {
          const run = resolveCoverageRun(command, worktree, join(dir, String(runs.length + 1)));
          if (run) runs.push(run);
        }
        return runs;
      };

      const resolveRunChoice = (request: CoverageRequest, worktree: string, dir: string): RunChoice => {
        const setting = resolveRepoCoverage(request.repo);
        if (setting.mode === 'off') return null;
        if (setting.mode === 'auto') {
          const runs = listTestRuns(request.commands, worktree, dir);
          return runs.length > 0 ? { runs } : null;
        }
        const format = resolveCustomFormat(setting);
        if (!format) {
          return {
            command: setting.command,
            refusal: `Shinsa cannot tell the format of ${setting.report} from its name.`,
          };
        }
        const report = join(worktree, setting.report);
        return { runs: [{ tool: 'custom', command: setting.command, cwd: worktree, report, format }] };
      };

      const listRoots = (worktree: string) =>
        Effect.sync(() => {
          const real = realpathSync(worktree);
          return real === worktree ? [worktree] : [worktree, real];
        });

      const mergeHits = (into: CoverageHits, run: CoverageRun, hits: CoverageHits) => {
        for (const [path, lines] of hits) {
          const key = run.format === 'go' || isAbsolute(path) ? path : join(run.cwd, path);
          const known = into.get(key) ?? new Map<number, number>();
          for (const [line, count] of lines) known.set(line, (known.get(line) ?? 0) + count);
          into.set(key, known);
        }
      };

      const runCoverage = Effect.fn('TaskCoverage.runCoverage')(function* (
        request: CoverageRequest,
        worktree: string,
        run: CoverageRun
      ) {
        yield* Effect.try({
          try: () => {
            rmSync(run.report, { force: true });
            mkdirSync(dirname(run.report), { recursive: true });
          },
          catch: (error) => new CoverageReportUnreadable({ path: run.report, message: describeError(error) }),
        });
        const result = yield* runner.command(['sh', '-c', run.command], worktree, {
          timeoutMs: request.timeoutMs ?? CHECK_TIMEOUT_MS,
          signal: request.signal,
        });
        if (result.timedOut) return 'It ran too long and was stopped.';
        if (!(yield* Effect.sync(() => existsSync(run.report))))
          return `It wrote no report at ${run.report} (exit ${result.code}).`;
        const text = yield* Effect.try({
          try: () => readFileSync(run.report, 'utf8'),
          catch: (error) => new CoverageReportUnreadable({ path: run.report, message: describeError(error) }),
        });
        const hits = parseCoverageReport(run.format, text);
        return hits.size === 0 ? `The report at ${run.report} lists no files.` : hits;
      });

      const collectHits = Effect.fn('TaskCoverage.collectHits')(function* (
        request: CoverageRequest,
        worktree: string,
        runs: readonly CoverageRun[]
      ) {
        const hits: CoverageHits = new Map();
        const problems: string[] = [];
        for (const run of runs) {
          if (request.signal?.aborted) return null;
          const read = yield* runCoverage(request, worktree, run);
          if (typeof read === 'string') problems.push(read);
          else mergeHits(hits, run, read);
        }
        return { hits, problems };
      });

      const measureRuns = Effect.fn('TaskCoverage.measureRuns')(function* (
        request: CoverageRequest,
        worktree: string,
        runs: readonly CoverageRun[]
      ) {
        const { signal } = request;
        const command = runs.map((run) => run.command).join('\n');
        const collected = yield* collectHits(request, worktree, runs);
        if (!collected || signal?.aborted) return null;
        if (collected.hits.size === 0) return resolveUnavailable(command, collected.problems.join(' '));
        const refs = yield* history.taskRefs(request.repo, request.task, request.baseBranch, signal);
        if (!refs.base) return resolveUnavailable(command, NO_BASE_COMMIT);
        const changed = parseChangedLines(yield* history.changedLinesPatch(worktree, refs.base, signal));
        const modulePath = Option.getOrNull(yield* withFiles(selectGoModule(worktree)));
        return measureCoverage({
          command: command.slice(0, COVERAGE_LIMITS.command),
          changed,
          hits: collected.hits,
          roots: yield* listRoots(worktree),
          modulePath,
        });
      });

      const measure = Effect.fn('TaskCoverage.measure')(function* (request: CoverageRequest) {
        const worktree = request.task.worktreePath;
        if (!worktree || request.signal?.aborted) return null;
        const dir = yield* Effect.acquireRelease(
          Effect.sync(() => mkdtempSync(join(tmpdir(), COVERAGE_DIR_PREFIX))),
          (made) => Effect.sync(() => rmSync(made, { recursive: true, force: true }))
        );
        const choice = resolveRunChoice(request, worktree, dir);
        if (!choice) return null;
        if ('refusal' in choice) return resolveUnavailable(choice.command, choice.refusal);
        return yield* measureRuns(request, worktree, choice.runs).pipe(
          Effect.catch((error) =>
            Effect.succeed(
              resolveUnavailable(choice.runs.map((run) => run.command).join('\n'), describeError(error))
            )
          )
        );
      }, Effect.scoped);

      return TaskCoverage.of({ measure });
    })
  );
}
