import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { Command } from './kit/command/index.ts';
import { type CommandArgv, CommandFailed, type CommandOutput } from './kit/command/schema.ts';
import { MAX_RERUN_ATTEMPT, type RunJob, resolveRerun, runWatchRerun } from './watch-rerun.ts';

const withoutRunner: RunJob = { name: 'mac', conclusion: 'cancelled', runner_id: 0, steps: [] };
const passed: RunJob = { name: 'trigger', conclusion: 'success', runner_id: 1000001549, steps: [{}] };
const skipped: RunJob = { name: 'npm', conclusion: 'skipped', runner_id: null, steps: [] };
const ranAndFailed: RunJob = { name: 'npm', conclusion: 'failure', runner_id: 1000001550, steps: [{}, {}] };

describe('resolveRerun', () => {
  const base = { runId: 41480267284, attempt: 1, newestRunId: 41480267284 };

  it('reruns a run whose only failed job never got a runner', () => {
    expect(resolveRerun({ ...base, jobs: [passed, withoutRunner, skipped] })).toEqual({
      rerun: true,
      reason: 'No runner picked up mac on attempt 1, so its failed jobs run again.',
    });
  });

  it('counts a job with no steps list and no runner as never picked up', () => {
    const queued: RunJob = { name: 'linux', conclusion: 'timed_out', runner_id: null };
    expect(resolveRerun({ ...base, jobs: [queued, withoutRunner] }).rerun).toBe(true);
  });

  it('reports a run where a job ran and failed, even beside one that got no runner', () => {
    expect(resolveRerun({ ...base, jobs: [withoutRunner, ranAndFailed] })).toEqual({
      rerun: false,
      reason: 'These jobs ran and failed: npm.',
    });
  });

  it('reports a job that got a runner but failed before any step', () => {
    const lostRunner: RunJob = { name: 'mac', conclusion: 'failure', runner_id: 42, steps: [] };
    expect(resolveRerun({ ...base, jobs: [lostRunner] }).rerun).toBe(false);
  });

  it('reports a failed run with no failed job', () => {
    const pending: RunJob = { name: 'status', conclusion: null, runner_id: null };
    expect(resolveRerun({ ...base, jobs: [passed, skipped, pending] })).toEqual({
      rerun: false,
      reason: 'No job failed, so there is nothing to rerun.',
    });
  });

  it(`reruns up to attempt ${MAX_RERUN_ATTEMPT} and reports the attempt after it`, () => {
    expect(resolveRerun({ ...base, attempt: MAX_RERUN_ATTEMPT, jobs: [withoutRunner] }).rerun).toBe(true);
    expect(resolveRerun({ ...base, attempt: MAX_RERUN_ATTEMPT + 1, jobs: [withoutRunner] })).toEqual({
      rerun: false,
      reason: 'Attempt 3 still got no runner, so it is not rerun again.',
    });
  });

  it('reports a run that a newer run of its workflow on main has overtaken', () => {
    expect(resolveRerun({ ...base, newestRunId: 41490000000, jobs: [withoutRunner] })).toEqual({
      rerun: false,
      reason: 'Run 41490000000 on main is newer, so this run is not rerun.',
    });
  });
});

describe('runWatchRerun', () => {
  let outputDir: string | undefined;

  afterEach(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    outputDir = undefined;
  });

  const env = { GH_REPO: 'shinsa-dev/shinsa', RUN_ID: '41480267284', RUN_ATTEMPT: '1', WORKFLOW_ID: '7' };
  const jobsPath = 'repos/shinsa-dev/shinsa/actions/runs/41480267284/attempts/1/jobs?per_page=100';
  const newestPath = 'repos/shinsa-dev/shinsa/actions/workflows/7/runs?branch=main&per_page=1';

  function createGh(responses: { jobs: unknown; newest: { id: number }[]; rerun?: CommandOutput }) {
    const calls: string[][] = [];
    const answer = (argv: CommandArgv): CommandOutput => {
      calls.push([...argv]);
      if (argv[2] === jobsPath)
        return { code: 0, stdout: JSON.stringify({ jobs: responses.jobs }), stderr: '' };
      if (argv[2] === newestPath)
        return { code: 0, stdout: JSON.stringify({ workflow_runs: responses.newest }), stderr: '' };
      return responses.rerun ?? { code: 0, stdout: '', stderr: '' };
    };
    const text = (argv: CommandArgv) => {
      const output = answer(argv);
      if (output.code === 0) return Effect.succeed(output.stdout);
      const command = argv.slice(0, 2).join(' ');
      return Effect.fail(
        new CommandFailed({
          command,
          code: output.code,
          stderr: output.stderr,
          message: `${command} failed (${output.code}): ${output.stderr}`,
        })
      );
    };
    const layer = Layer.succeed(
      Command,
      Command.of({
        run: (argv) => Effect.sync(() => answer(argv)),
        text,
        lines: (argv) => Effect.map(text(argv), (output) => output.split('\n')),
      })
    );
    const run = (input: Record<string, string | undefined>) =>
      Effect.runPromise(runWatchRerun(input).pipe(Effect.provide(Layer.merge(layer, BunServices.layer))));
    const refuse = (input: Record<string, string | undefined>) =>
      Effect.runPromise(
        Effect.flip(runWatchRerun(input)).pipe(Effect.provide(Layer.merge(layer, BunServices.layer)))
      );
    return { calls, run, refuse };
  }

  function createOutput() {
    outputDir = mkdtempSync(join(tmpdir(), 'watch-rerun-'));
    return join(outputDir, 'output');
  }

  it('reruns the failed jobs and says so in the step output', async () => {
    const output = createOutput();
    const gh = createGh({ jobs: [passed, withoutRunner], newest: [{ id: 41480267284 }] });
    expect(await gh.run({ ...env, GITHUB_OUTPUT: output })).toBe(
      'No runner picked up mac on attempt 1, so its failed jobs run again.'
    );
    expect(gh.calls).toEqual([
      ['gh', 'api', jobsPath],
      ['gh', 'api', newestPath],
      ['gh', 'run', 'rerun', '41480267284', '--failed', '--repo', 'shinsa-dev/shinsa'],
    ]);
    expect(readFileSync(output, 'utf8')).toBe('rerun=true\n');
  });

  it('leaves a real failure for the report, without rerunning, and adds to the step output', async () => {
    const output = createOutput();
    const gh = createGh({ jobs: [ranAndFailed], newest: [{ id: 41480267284 }] });
    await gh.run({ ...env, GITHUB_OUTPUT: output });
    expect(await gh.run({ ...env, GITHUB_OUTPUT: output })).toBe('These jobs ran and failed: npm.');
    expect(gh.calls).toHaveLength(4);
    expect(readFileSync(output, 'utf8')).toBe('rerun=false\nrerun=false\n');
  });

  it('treats the run as the newest when its workflow lists no run on main', async () => {
    const gh = createGh({ jobs: [withoutRunner], newest: [] });
    await gh.run(env);
    expect(gh.calls).toHaveLength(3);
  });

  it('fails when gh fails, so the run is reported', async () => {
    const gh = createGh({
      jobs: [withoutRunner],
      newest: [{ id: 41480267284 }],
      rerun: { code: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' },
    });
    const error = await gh.refuse(env);
    expect(error._tag).toBe('CommandFailed');
    expect(error.message).toBe('gh run failed (1): HTTP 403: Resource not accessible by integration');
  });

  it('fails when gh answers something that is not a list of jobs', async () => {
    const gh = createGh({ jobs: [{ name: 'mac' }], newest: [] });
    const error = await gh.refuse(env);
    expect(error).toMatchObject({
      _tag: 'WatchAnswerInvalid',
      message: `gh api ${jobsPath} answered something else.`,
    });
  });

  it('asks for the repository and each of the run ids', async () => {
    const gh = createGh({ jobs: [], newest: [] });
    expect((await gh.refuse({ ...env, GH_REPO: '' })).message).toBe(
      'Set GH_REPO to the repository, as owner/name.'
    );
    expect((await gh.refuse({ ...env, RUN_ID: undefined })).message).toBe(
      "Set RUN_ID to the failed run's id."
    );
    expect((await gh.refuse({ ...env, RUN_ATTEMPT: '0' })).message).toBe(
      "Set RUN_ATTEMPT to the failed run's attempt."
    );
    expect((await gh.refuse({ ...env, WORKFLOW_ID: '1.5' })).message).toBe(
      "Set WORKFLOW_ID to the failed run's workflow id."
    );
    expect(gh.calls).toEqual([]);
  });
});
