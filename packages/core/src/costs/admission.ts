import { CLAUDE_PROVIDER } from '../agent-models/index.ts';
import {
  isTaskSettled,
  MINUTE_MS,
  resolveProjectOrder,
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

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

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

function resolveProjectRank(order: readonly string[], task: Task) {
  const index = task.projectId ? order.indexOf(task.projectId) : -1;
  return index === -1 ? order.length : index;
}

function countUnblocked(state: ShinsaState, task: Task) {
  return Object.values(state.tasks).filter(
    (other) => !isTaskSettled(other) && other.waitsOn.includes(task.id)
  ).length;
}

export function sortAdmissionQueue(state: ShinsaState, tasks: readonly Task[]) {
  const order = resolveProjectOrder(state.settings);
  const keyed = tasks.map((task) => ({
    task,
    urgent: task.priority === 'urgent' ? 0 : 1,
    project: resolveProjectRank(order, task),
    priority: PRIORITY_RANK[task.priority],
    unblocks: countUnblocked(state, task),
  }));
  keyed.sort(
    (a, b) =>
      a.urgent - b.urgent ||
      a.project - b.project ||
      a.priority - b.priority ||
      b.unblocks - a.unblocks ||
      a.task.createdAt - b.task.createdAt ||
      a.task.id.localeCompare(b.task.id)
  );
  return keyed.map((entry) => entry.task);
}

function resolveCommitted(state: ShinsaState, provider: string, skip: string) {
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
