import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandResult } from './run-command.ts';
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

  function createGh(responses: { jobs: RunJob[]; newest: { id: number }[]; rerun?: CommandResult }) {
    const calls: string[][] = [];
    const run = (argv: string[]): CommandResult => {
      calls.push(argv);
      if (argv[2] === jobsPath)
        return { exitCode: 0, stdout: JSON.stringify({ jobs: responses.jobs }), stderr: '' };
      if (argv[2] === newestPath) {
        return { exitCode: 0, stdout: JSON.stringify({ workflow_runs: responses.newest }), stderr: '' };
      }
      return responses.rerun ?? { exitCode: 0, stdout: '', stderr: '' };
    };
    return { calls, run };
  }

  function createOutput() {
    outputDir = mkdtempSync(join(tmpdir(), 'watch-rerun-'));
    return join(outputDir, 'output');
  }

  it('reruns the failed jobs and says so in the step output', () => {
    const output = createOutput();
    const gh = createGh({ jobs: [passed, withoutRunner], newest: [{ id: 41480267284 }] });
    expect(runWatchRerun({ ...env, GITHUB_OUTPUT: output }, gh.run)).toBe(
      'No runner picked up mac on attempt 1, so its failed jobs run again.\n'
    );
    expect(gh.calls).toEqual([
      ['gh', 'api', jobsPath],
      ['gh', 'api', newestPath],
      ['gh', 'run', 'rerun', '41480267284', '--failed', '--repo', 'shinsa-dev/shinsa'],
    ]);
    expect(readFileSync(output, 'utf8')).toBe('rerun=true\n');
  });

  it('leaves a real failure for the report, without rerunning', () => {
    const output = createOutput();
    const gh = createGh({ jobs: [ranAndFailed], newest: [{ id: 41480267284 }] });
    expect(runWatchRerun({ ...env, GITHUB_OUTPUT: output }, gh.run)).toBe(
      'These jobs ran and failed: npm.\n'
    );
    expect(gh.calls).toHaveLength(2);
    expect(readFileSync(output, 'utf8')).toBe('rerun=false\n');
  });

  it('treats the run as the newest when its workflow lists no run on main', () => {
    const gh = createGh({ jobs: [withoutRunner], newest: [] });
    runWatchRerun(env, gh.run);
    expect(gh.calls).toHaveLength(3);
  });

  it('fails when gh fails, so the run is reported', () => {
    const gh = createGh({
      jobs: [withoutRunner],
      newest: [{ id: 41480267284 }],
      rerun: { exitCode: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration\n' },
    });
    expect(() => runWatchRerun(env, gh.run)).toThrow(
      'gh run rerun 41480267284 --failed --repo shinsa-dev/shinsa failed: HTTP 403: Resource not accessible by integration'
    );
  });

  it('asks for the repository and each of the run ids', () => {
    const gh = createGh({ jobs: [], newest: [] });
    expect(() => runWatchRerun({ ...env, GH_REPO: '' }, gh.run)).toThrow(
      'Set GH_REPO to the repository, as owner/name.'
    );
    expect(() => runWatchRerun({ ...env, RUN_ID: undefined }, gh.run)).toThrow(
      "Set RUN_ID to the failed run's id."
    );
    expect(() => runWatchRerun({ ...env, RUN_ATTEMPT: '0' }, gh.run)).toThrow(
      "Set RUN_ATTEMPT to the failed run's attempt."
    );
    expect(() => runWatchRerun({ ...env, WORKFLOW_ID: '1.5' }, gh.run)).toThrow(
      "Set WORKFLOW_ID to the failed run's workflow id."
    );
    expect(gh.calls).toEqual([]);
  });
});
