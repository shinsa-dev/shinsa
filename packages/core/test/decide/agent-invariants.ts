import { expect } from 'bun:test';
import {
  isDelegatedRun,
  listActiveRuns,
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
};

const FRESH_FAILURES: ReadonlySet<RunFailureClass> = new Set<RunFailureClass>([
  'context_window_full',
  'image_error',
  'session_lost',
]);

const INQUIRY_ROLES: ReadonlySet<RunRole> = new Set<RunRole>(['answerer', 'investigator', 'researcher']);

function isRootCandidate(run: Run, started: Run) {
  if (run.taskId !== started.taskId || isDelegatedRun(run)) return false;
  if (run.role === 'agent') return true;
  return INQUIRY_ROLES.has(run.role) && (run.round ?? 1) === (started.round ?? 1);
}

function selectRoundRoot(state: ShinsaState, started: Run) {
  let last: Run | null = null;
  for (const run of Object.values(state.runs)) {
    if (!isRootCandidate(run, started)) continue;
    if (!last || run.startedAt >= last.startedAt) last = run;
  }
  return last;
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

export function assertOneSessionPerRound(state: ShinsaState, event: ShinsaEventInput, context: string) {
  if (event.type !== 'run.started' || event.run.role !== 'agent' || isDelegatedRun(event.run)) return;
  const last = selectRoundRoot(state, event.run);
  if (!last) return;
  if (last.role !== 'agent' && (last.provider !== event.run.provider || last.model !== event.run.model)) {
    expect(event.run.resume, `${context}: an agent run that resumes an inquiry on other settings`).toBe(
      false
    );
    return;
  }
  if (!last.sessionId) return;
  if (last.failure && FRESH_FAILURES.has(last.failure.class)) return;
  expect(
    event.run,
    `${context}: an agent run that does not resume the round's session, the inquiry's included`
  ).toMatchObject({
    resume: true,
    sessionId: last.sessionId,
  });
}
