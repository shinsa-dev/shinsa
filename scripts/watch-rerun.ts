import { BunRuntime } from '@effect/platform-bun';
import { Console, Effect, FileSystem, Schema } from 'effect';
import { Command, CommandLayer } from './kit/command/index.ts';
import { reportFailure } from './kit/script.ts';
import { ScriptUsage } from './release/schema.ts';

export const MAX_RERUN_ATTEMPT = 2;

const FAILED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure']);

export const RunJob = Schema.Struct({
  name: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  runner_id: Schema.NullOr(Schema.Number),
  steps: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
export type RunJob = typeof RunJob.Type;

const RunJobs = Schema.Struct({ jobs: Schema.Array(RunJob) });

const WorkflowRuns = Schema.Struct({ workflow_runs: Schema.Array(Schema.Struct({ id: Schema.Number })) });

export class WatchAnswerInvalid extends Schema.TaggedError<
  WatchAnswerInvalid,
  { readonly brand: unique symbol }
>()('WatchAnswerInvalid', { message: Schema.String }) {}

export interface RerunInput {
  runId: number;
  attempt: number;
  jobs: readonly RunJob[];
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

const decodeRunJobs = Schema.decodeUnknownEffect(Schema.fromJsonString(RunJobs));

const decodeWorkflowRuns = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkflowRuns));

const findPositiveInteger = Effect.fn('WatchRerun.findPositiveInteger')(function* (
  env: Record<string, string | undefined>,
  name: string,
  meaning: string
) {
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 1)
    return yield* new ScriptUsage({ message: `Set ${name} to ${meaning}.` });
  return value;
});

export const runWatchRerun = Effect.fn('WatchRerun.run')(function* (env: Record<string, string | undefined>) {
  const command = yield* Command;
  const fs = yield* FileSystem.FileSystem;
  const repo = env.GH_REPO;
  if (!repo) return yield* new ScriptUsage({ message: 'Set GH_REPO to the repository, as owner/name.' });
  const runId = yield* findPositiveInteger(env, 'RUN_ID', "the failed run's id");
  const attempt = yield* findPositiveInteger(env, 'RUN_ATTEMPT', "the failed run's attempt");
  const workflowId = yield* findPositiveInteger(env, 'WORKFLOW_ID', "the failed run's workflow id");
  const toInvalid = (path: string) => () =>
    new WatchAnswerInvalid({ message: `gh api ${path} answered something else.` });
  const jobsPath = `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`;
  const { jobs } = yield* command
    .text(['gh', 'api', jobsPath])
    .pipe(Effect.flatMap((text) => decodeRunJobs(text).pipe(Effect.mapError(toInvalid(jobsPath)))));
  const newestPath = `repos/${repo}/actions/workflows/${workflowId}/runs?branch=main&per_page=1`;
  const { workflow_runs: newest } = yield* command
    .text(['gh', 'api', newestPath])
    .pipe(Effect.flatMap((text) => decodeWorkflowRuns(text).pipe(Effect.mapError(toInvalid(newestPath)))));
  const decision = resolveRerun({ runId, attempt, jobs, newestRunId: newest[0]?.id ?? runId });
  if (decision.rerun) yield* command.text(['gh', 'run', 'rerun', String(runId), '--failed', '--repo', repo]);
  if (env.GITHUB_OUTPUT)
    yield* fs.writeFileString(env.GITHUB_OUTPUT, `rerun=${decision.rerun}\n`, { flag: 'a' });
  return decision.reason;
});

const main = runWatchRerun(Bun.env).pipe(
  Effect.flatMap(Console.log),
  reportFailure,
  Effect.provide(CommandLayer)
);

if (import.meta.main) BunRuntime.runMain(main, { disableErrorReporting: true });
