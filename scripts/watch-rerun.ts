import { appendFileSync } from 'node:fs';
import { type RunCommand, runCommand } from './run-command.ts';

export const MAX_RERUN_ATTEMPT = 2;

const FAILED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure']);

export interface RunJob {
  name: string;
  conclusion: string | null;
  runner_id: number | null;
  steps?: unknown[];
}

export interface RerunInput {
  runId: number;
  attempt: number;
  jobs: RunJob[];
  newestRunId: number;
}

export interface RerunDecision {
  rerun: boolean;
  reason: string;
}

function isWithoutRunner(job: RunJob) {
  return !job.runner_id && (job.steps ?? []).length === 0;
}

export function resolveRerun(input: RerunInput): RerunDecision {
  const failed = input.jobs.filter(
    (job) => job.conclusion !== null && FAILED_CONCLUSIONS.has(job.conclusion)
  );
  if (failed.length === 0) return { rerun: false, reason: 'No job failed, so there is nothing to rerun.' };
  const started = failed.filter((job) => !isWithoutRunner(job)).map((job) => job.name);
  if (started.length > 0) {
    return { rerun: false, reason: `These jobs ran and failed: ${started.join(', ')}.` };
  }
  if (input.attempt > MAX_RERUN_ATTEMPT) {
    return {
      rerun: false,
      reason: `Attempt ${input.attempt} still got no runner, so it is not rerun again.`,
    };
  }
  if (input.newestRunId !== input.runId) {
    return { rerun: false, reason: `Run ${input.newestRunId} on main is newer, so this run is not rerun.` };
  }
  const names = failed.map((job) => job.name).join(', ');
  return {
    rerun: true,
    reason: `No runner picked up ${names} on attempt ${input.attempt}, so its failed jobs run again.`,
  };
}

function runGh(run: RunCommand, argv: string[]) {
  const result = run(['gh', ...argv]);
  if (result.exitCode !== 0) throw new Error(`gh ${argv.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function findPositiveInteger(env: Record<string, string | undefined>, name: string, meaning: string) {
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Set ${name} to ${meaning}.`);
  return value;
}

export function runWatchRerun(env: Record<string, string | undefined>, run: RunCommand) {
  const repo = env.GH_REPO;
  if (!repo) throw new Error('Set GH_REPO to the repository, as owner/name.');
  const runId = findPositiveInteger(env, 'RUN_ID', "the failed run's id");
  const attempt = findPositiveInteger(env, 'RUN_ATTEMPT', "the failed run's attempt");
  const workflowId = findPositiveInteger(env, 'WORKFLOW_ID', "the failed run's workflow id");
  const { jobs } = JSON.parse(
    runGh(run, ['api', `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`])
  ) as { jobs: RunJob[] };
  const { workflow_runs: newest } = JSON.parse(
    runGh(run, ['api', `repos/${repo}/actions/workflows/${workflowId}/runs?branch=main&per_page=1`])
  ) as { workflow_runs: { id: number }[] };
  const decision = resolveRerun({ runId, attempt, jobs, newestRunId: newest[0]?.id ?? runId });
  if (decision.rerun) runGh(run, ['run', 'rerun', String(runId), '--failed', '--repo', repo]);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `rerun=${decision.rerun}\n`);
  return `${decision.reason}\n`;
}

if (import.meta.main) process.stdout.write(runWatchRerun(Bun.env, runCommand));
