import {
  capitalise,
  type DelegatedRun,
  type DelegationStatus,
  describeDelegateRole,
  isDelegatedRun,
  listChildRuns,
  listDelegatedRuns,
  type Run,
  resolveCurrentRound,
  resolveDelegationStatus,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';
import type { Status } from '@/lib/tasks/status.ts';

export interface DelegationView {
  run: DelegatedRun;
  title: string;
  role: string;
  status: DelegationStatus;
  live: boolean;
  question: string | null;
  result: string | null;
}

const STATUS: Record<DelegationStatus, Status> = {
  queued: { label: 'Waiting to start', tone: 'neutral' },
  running: { label: 'Working', tone: 'blue' },
  waiting: { label: 'Waiting for its delegated tasks', tone: 'blue' },
  completed: { label: 'Finished', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
};

export const DELEGATION_OUTCOME: Record<
  Exclude<DelegationStatus, 'queued' | 'running' | 'waiting'>,
  'pass' | 'fail' | 'skipped'
> = {
  completed: 'pass',
  failed: 'fail',
  cancelled: 'skipped',
};

const ASKED: Status = { label: 'Waiting for the agent that delegated it to answer', tone: 'amber' };

function resolveOpenQuestion(run: DelegatedRun) {
  const question = run.delegation.question;
  return run.endedAt === null && question && question.answer === null ? question.question : null;
}

function describeDelegation(run: DelegatedRun): DelegationView {
  return {
    run,
    title: run.delegation.title,
    role: capitalise(describeDelegateRole(run.role)),
    status: resolveDelegationStatus(run),
    live: run.endedAt === null,
    question: resolveOpenQuestion(run),
    result: run.endedAt === null ? null : run.summary,
  };
}

export function resolveDelegationStatusLabel(view: DelegationView): Status {
  return view.question === null ? STATUS[view.status] : ASKED;
}

export function describeReportVerb(view: DelegationView) {
  return view.status === 'completed' ? 'Reported back' : resolveDelegationStatusLabel(view).label;
}

export function describeStopDelegation(view: DelegationView) {
  return `Stop “${view.title}” and what it delegated`;
}

export function selectDelegation(state: ShinsaState, runId: string): DelegationView | null {
  const run = state.runs[runId];
  return run && isDelegatedRun(run) ? describeDelegation(run) : null;
}

function listTreeUnder(state: ShinsaState, roots: DelegatedRun[]) {
  const ordered: { view: DelegationView; depth: number }[] = [];
  const visit = (run: DelegatedRun) => {
    ordered.push({ view: describeDelegation(run), depth: run.delegation.depth });
    for (const child of listChildRuns(state, run.id)) visit(child);
  };
  for (const run of roots) visit(run);
  return ordered;
}

function listRootDelegations(state: ShinsaState, taskId: string) {
  return listDelegatedRuns(state, taskId).filter((run) => run.delegation.depth === 1);
}

export function listDelegationTree(state: ShinsaState, taskId: string) {
  return listTreeUnder(state, listRootDelegations(state, taskId));
}

export function listRoundDelegationTree(state: ShinsaState, task: Task) {
  const round = resolveCurrentRound(task).number;
  const roots = listRootDelegations(state, task.id).filter(
    (run) => (state.runs[run.delegation.parentRunId]?.round ?? 1) === round
  );
  return listTreeUnder(state, roots);
}

export function listLiveDelegations(state: ShinsaState, taskId: string) {
  return listDelegationTree(state, taskId)
    .map((entry) => entry.view)
    .filter((view) => view.live);
}

export function describeDelegations(views: DelegationView[]) {
  const live = views.filter((view) => view.live).length;
  const done = views.length - live;
  const parts = [live > 0 ? `${live} working` : null, done > 0 ? `${done} done` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function listChatRuns(runs: Run[]) {
  return runs.filter((run) => !isDelegatedRun(run));
}

function traceDelegation(state: ShinsaState, runId: string | null) {
  const path = new Set<string>();
  let run = runId ? state.runs[runId] : undefined;
  while (run && isDelegatedRun(run) && !path.has(run.id)) {
    path.add(run.id);
    run = state.runs[run.delegation.parentRunId];
  }
  return { path, step: run?.id ?? null };
}

export function listDelegationPath(state: ShinsaState, runId: string | null) {
  return traceDelegation(state, runId).path;
}

export function resolveStepRunId(state: ShinsaState, runId: string | null) {
  return traceDelegation(state, runId).step ?? runId;
}

export function describeParkedRun(run: Run): Status | null {
  if (run.endedAt !== null) return null;
  const question = run.delegation?.question;
  if (question && question.answer === null) return ASKED;
  if (run.status !== 'waiting') return null;
  const count = run.waitingOn?.delegations.length ?? 0;
  return {
    label:
      count > 0
        ? `Waiting for ${formatCount(count, 'delegated task', 'delegated tasks')}`
        : STATUS.waiting.label,
    tone: 'blue',
  };
}
