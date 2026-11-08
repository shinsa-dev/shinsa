import { CLAUDE_PROVIDER } from '../agent-models/index.ts';
import {
  DAY_MS,
  type Gate,
  isTaskSettled,
  MINUTE_MS,
  type Run,
  type Task,
  type TaskPriority,
} from '../domain/index.ts';
import { isOfCurrentRound } from '../domain/rounds.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveBuildEstimate } from './estimate.ts';
import { resolveRecentUsage, resolveRecentUsageFreesAt } from './window.ts';

export const ADMISSION_LIMITS = {
  reserve: 0.1,
  recheckMs: 30 * MINUTE_MS,
} as const;

export const ENGAGEMENT_LIMITS = {
  windowMs: 14 * DAY_MS,
  minAnswers: 3,
} as const;

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const RESPONSES = new WeakMap<Record<string, Gate>, Map<string, number>>();

export interface AdmissionVerdict {
  fits: boolean;
  need: number;
  limit: number;
  percent: number;
  freesAt: number;
}

export function isBuildRun(run: Run) {
  return run.purpose === 'build';
}

function isReleased(task: Task, run: Run) {
  const wait = task.usageWait;
  return (
    run.endedAt === null &&
    wait?.pace?.scope === 'admission' &&
    wait.status === 'resumed' &&
    wait.id === run.usageWaitId
  );
}

function isStartedBuild(task: Task, run: Run) {
  return (run.status ?? 'queued') !== 'queued' || isReleased(task, run);
}

export function listBuildingTasks(state: ShinsaState) {
  const building = new Map<string, string>();
  for (const run of Object.values(state.runs)) {
    if (!isBuildRun(run)) continue;
    const task = state.tasks[run.taskId];
    if (!task || isTaskSettled(task) || !isOfCurrentRound(task, run) || !isStartedBuild(task, run)) continue;
    building.set(task.id, run.provider ?? CLAUDE_PROVIDER);
  }
  return building;
}

function resolveMedian(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

export function resolveProjectResponses(state: Pick<ShinsaState, 'gates' | 'tasks'>, now: number) {
  const known = RESPONSES.get(state.gates);
  if (known) return known;
  const byProject = new Map<string, number[]>();
  for (const gate of Object.values(state.gates)) {
    const projectId = state.tasks[gate.taskId]?.projectId;
    if (!projectId || gate.answeredAt === null || now - gate.answeredAt > ENGAGEMENT_LIMITS.windowMs)
      continue;
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), gate.answeredAt - gate.openedAt]);
  }
  const responses = new Map<string, number>();
  for (const [projectId, waits] of byProject) {
    if (waits.length >= ENGAGEMENT_LIMITS.minAnswers) responses.set(projectId, resolveMedian(waits));
  }
  RESPONSES.set(state.gates, responses);
  return responses;
}

function resolveProjectRank(state: ShinsaState, responses: Map<string, number>, task: Task) {
  if (!task.projectId) return Number.POSITIVE_INFINITY;
  if (task.projectId === state.focus.projectId) return Number.NEGATIVE_INFINITY;
  return responses.get(task.projectId) ?? Number.POSITIVE_INFINITY;
}

function countUnblocked(state: ShinsaState, task: Task) {
  return Object.values(state.tasks).filter(
    (other) => !isTaskSettled(other) && other.waitsOn.includes(task.id)
  ).length;
}

function compareRanks(a: number, b: number) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function sortAdmissionQueue(state: ShinsaState, tasks: readonly Task[], now: number) {
  const responses = resolveProjectResponses(state, now);
  const keyed = tasks.map((task) => ({
    task,
    priority: PRIORITY_RANK[task.priority],
    project: resolveProjectRank(state, responses, task),
    unblocks: countUnblocked(state, task),
  }));
  keyed.sort(
    (a, b) =>
      a.priority - b.priority ||
      compareRanks(a.project, b.project) ||
      b.unblocks - a.unblocks ||
      a.task.createdAt - b.task.createdAt ||
      a.task.id.localeCompare(b.task.id)
  );
  return keyed.map((entry) => entry.task);
}

function resolveCommitted(state: ShinsaState, provider: string, skip: string | null) {
  let committed = 0;
  for (const [taskId, buildProvider] of listBuildingTasks(state)) {
    const task = state.tasks[taskId];
    if (taskId === skip || buildProvider !== provider || !task) continue;
    committed += resolveBuildEstimate(state, task)?.remainingPercent ?? 0;
  }
  return committed;
}

export function resolveAdmission(
  state: ShinsaState,
  task: Task,
  provider: string,
  now: number
): AdmissionVerdict | null {
  const pace = state.usagePaces[provider]?.pace ?? null;
  const estimate = resolveBuildEstimate(state, task)?.remainingPercent ?? null;
  if (pace === null || estimate === null) return null;
  const limit = task.priority === 'urgent' ? pace : pace * (1 - ADMISSION_LIMITS.reserve);
  const need = Math.min(estimate, limit);
  const recent = resolveRecentUsage(state, now, { provider });
  const percent = recent.percent + resolveCommitted(state, provider, task.id);
  const fits = percent + need <= limit;
  const freesAt = fits
    ? now
    : (resolveRecentUsageFreesAt(recent, limit - (percent - recent.percent) - need) ??
      now + ADMISSION_LIMITS.recheckMs);
  return { fits, need, limit, percent, freesAt: Math.max(freesAt, now + MINUTE_MS) };
}

export function resolveAdmissionRoom(state: ShinsaState, provider: string, now: number) {
  const pace = state.usagePaces[provider]?.pace ?? null;
  if (pace === null) return null;
  const used = resolveRecentUsage(state, now, { provider }).percent + resolveCommitted(state, provider, null);
  return pace * (1 - ADMISSION_LIMITS.reserve) - used;
}
