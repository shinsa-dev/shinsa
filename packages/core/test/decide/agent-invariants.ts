import { expect } from 'bun:test';
import {
  isDelegatedRun,
  isWatchSession,
  listActiveRuns,
  RUN_AGENT_ROLE,
  type Run,
  type RunFailureClass,
  type RunPurpose,
  type RunRole,
  type ShinsaEventInput,
  type ShinsaState,
  type Task,
  type TaskStage,
} from '../../src/index.ts';

const STEP_ROLES: ReadonlySet<RunRole> = new Set<RunRole>([
  'agent',
  'reviewer',
  'answerer',
  'investigator',
  'researcher',
]);

const PURPOSE_STAGE: Record<RunPurpose, TaskStage> = {
  plan: 'planning',
  build: 'building',
  fix: 'fixing',
  operate: 'operating',
  watch: 'watching',
  intake: 'watching',
};

const FRESH_FAILURES: ReadonlySet<RunFailureClass> = new Set<RunFailureClass>([
  'context_window_full',
  'image_error',
  'session_lost',
]);

const SESSION_ENDING: ReadonlySet<RunFailureClass> = new Set<RunFailureClass>([
  'context_window_full',
  'image_error',
]);

const SESSION_ROLES: ReadonlySet<RunRole> = new Set<RunRole>([
  'agent',
  'answerer',
  'investigator',
  'researcher',
]);

function selectSessionHolder(state: ShinsaState, started: Run) {
  const roles = SESSION_ROLES.has(started.role) ? SESSION_ROLES : new Set<RunRole>([started.role]);
  const runs = Object.values(state.runs).filter(
    (run) =>
      run.taskId === started.taskId &&
      run.id !== started.id &&
      !isDelegatedRun(run) &&
      run.sessionId &&
      isWatchSession(run) === isWatchSession(started)
  );
  const ended = new Set(
    runs.filter((run) => run.failure && SESSION_ENDING.has(run.failure.class)).map((run) => run.sessionId)
  );
  let last: Run | null = null;
  for (const run of runs) {
    if (!roles.has(run.role) || ended.has(run.sessionId)) continue;
    if (!last || run.startedAt >= last.startedAt) last = run;
  }
  return last;
}

function isRecoveredFresh(state: ShinsaState, started: Run) {
  let previous: Run | null = null;
  for (const run of Object.values(state.runs)) {
    if (run.taskId !== started.taskId || run.id === started.id || isDelegatedRun(run)) continue;
    if (run.role !== started.role || isWatchSession(run) !== isWatchSession(started)) continue;
    if (!previous || run.startedAt >= previous.startedAt) previous = run;
  }
  return Boolean(previous?.failure && FRESH_FAILURES.has(previous.failure.class));
}

function isSameProvider(last: Run, started: Run) {
  if (RUN_AGENT_ROLE[last.role] === RUN_AGENT_ROLE[started.role]) return true;
  return last.provider === started.provider;
}

export function assertAgentInvariants(state: ShinsaState, task: Task, context: string) {
  for (const run of Object.values(state.runs).filter((candidate) => candidate.taskId === task.id)) {
    if (!isDelegatedRun(run)) expect(STEP_ROLES.has(run.role), `${context}: ${run.role} run`).toBe(true);
    expect(run.purpose !== undefined, `${context}: purpose of a ${run.role} run`).toBe(run.role === 'agent');
  }
  for (const run of listActiveRuns(state, task.id)) {
    if (run.purpose) expect(task.stage, `${context}: a ${run.purpose} run`).toBe(PURPOSE_STAGE[run.purpose]);
  }
}

function hasHadSession(state: ShinsaState, started: Run) {
  return Object.values(state.runs).some(
    (run) =>
      run.taskId === started.taskId &&
      run.id !== started.id &&
      !isDelegatedRun(run) &&
      SESSION_ROLES.has(run.role) &&
      run.sessionId !== null
  );
}

function assertForkStartsSession(state: ShinsaState, started: Run, context: string) {
  if (!started.fork) return;
  const task = state.tasks[started.taskId];
  expect(started.fork.taskId, `${context}: a fork of another task than the task's source`).toBe(
    task?.forkOf ?? ''
  );
  expect(SESSION_ROLES.has(started.role), `${context}: a ${started.role} run that forks`).toBe(true);
  expect(hasHadSession(state, started), `${context}: a fork after the task had a session`).toBe(false);
  expect(started, `${context}: a fork that also resumes`).toMatchObject({ resume: false, sessionId: null });
  expect(state.runs[started.fork.runId]?.sessionId, `${context}: a fork of a session its run never had`).toBe(
    started.fork.sessionId
  );
}

export function assertOneSessionPerTask(state: ShinsaState, event: ShinsaEventInput, context: string) {
  if (event.type !== 'run.started' || isDelegatedRun(event.run)) return;
  if (!SESSION_ROLES.has(event.run.role) && event.run.role !== 'reviewer') return;
  const last = selectSessionHolder(state, event.run);
  assertForkStartsSession(state, event.run, context);
  if (!last || (event.run.resume === false && isRecoveredFresh(state, event.run))) return;
  if (!isSameProvider(last, event.run)) {
    expect(
      event.run.resume,
      `${context}: a run that resumes another role's session on another provider`
    ).toBe(false);
    return;
  }
  expect(
    event.run,
    `${context}: a ${event.run.role} run that does not resume the task's session`
  ).toMatchObject({
    resume: true,
    sessionId: last.sessionId,
  });
}
