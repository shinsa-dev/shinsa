import { Option } from 'effect';
import { CLAUDE_PROVIDER } from '../agent-models/index.ts';
import { isProjectInFocus } from '../domain/focus.ts';
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
import { resolveAutoPaceResets } from '../domain/settings.ts';
import { resolveFocusProjects } from '../queue/rank.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveBuildEstimate } from './estimate.ts';
import { resolveRecentUsage, resolveRecentUsageFreesAt } from './window.ts';

export const ADMISSION_LIMITS = {
  reserve: 0.1,
  recheckMs: 30 * MINUTE_MS,
  resetEndingMs: 3 * DAY_MS,
} as const;

const RESET_PRIORITIES: ReadonlySet<TaskPriority> = new Set(['urgent', 'high']);

export const ENGAGEMENT_LIMITS = {
  windowMs: 14 * DAY_MS,
  minAnswers: 3,
} as const;

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

interface KnownResponses {
  tasks: ShinsaState['tasks'];
  from: number;
  until: number;
  responses: Map<string, number>;
}

const RESPONSES = new WeakMap<Record<string, Gate>, KnownResponses>();

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
  if (known && known.tasks === state.tasks && now >= known.from && now < known.until) return known.responses;
  const byProject = new Map<string, number[]>();
  let until = Number.POSITIVE_INFINITY;
  for (const gate of Object.values(state.gates)) {
    const projectId = state.tasks[gate.taskId]?.projectId;
    if (!projectId || gate.answeredAt === null || now - gate.answeredAt > ENGAGEMENT_LIMITS.windowMs)
      continue;
    until = Math.min(until, gate.answeredAt + ENGAGEMENT_LIMITS.windowMs + 1);
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), gate.answeredAt - gate.openedAt]);
  }
  const responses = new Map<string, number>();
  for (const [projectId, waits] of byProject) {
    if (waits.length >= ENGAGEMENT_LIMITS.minAnswers) responses.set(projectId, resolveMedian(waits));
  }
  RESPONSES.set(state.gates, { tasks: state.tasks, from: now, until, responses });
  return responses;
}

function resolveProjectRank(state: ShinsaState, responses: Map<string, number>, task: Task, now: number) {
  if (!task.projectId) return Number.POSITIVE_INFINITY;
  const focus = resolveFocusProjects(state, now);
  if (focus.projectIds.length > 0 && isProjectInFocus(focus, task.projectId)) return Number.NEGATIVE_INFINITY;
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
    project: resolveProjectRank(state, responses, task, now),
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
    const estimate = Option.flatMap(resolveBuildEstimate(state, task), (found) => found.remainingPercent);
    committed += Option.getOrUndefined(estimate) ?? 0;
  }
  return committed;
}

function isResetEnding(state: ShinsaState, provider: string, now: number) {
  const endsAt = state.usagePaces[provider]?.resetEndsAt ?? null;
  return endsAt !== null && endsAt > now && endsAt - now <= ADMISSION_LIMITS.resetEndingMs;
}

function resolveAdmissionPace(
  state: ShinsaState,
  provider: string,
  priority: TaskPriority,
  now: number
): Option.Option<number> {
  return Option.map(Option.fromNullishOr(state.usagePaces[provider]), (recorded) => {
    if (!resolveAutoPaceResets(state.settings)) return recorded.pace;
    const counts = RESET_PRIORITIES.has(priority) || isResetEnding(state, provider, now);
    return counts ? Math.max(recorded.pace, recorded.resetPace) : recorded.pace;
  });
}

export function resolveAdmission(
  state: ShinsaState,
  task: Task,
  provider: string,
  now: number
): Option.Option<AdmissionVerdict> {
  const pace = Option.getOrNull(resolveAdmissionPace(state, provider, task.priority, now));
  const estimate = Option.getOrNull(
    Option.flatMap(resolveBuildEstimate(state, task), (found) => found.remainingPercent)
  );
  if (pace === null || estimate === null) return Option.none();
  const limit = task.priority === 'urgent' ? pace : pace * (1 - ADMISSION_LIMITS.reserve);
  const need = Math.min(estimate, limit);
  const recent = resolveRecentUsage(state, now, { provider });
  const percent = recent.percent + resolveCommitted(state, provider, task.id);
  const fits = percent + need <= limit;
  const freesAt = fits
    ? now
    : Option.getOrElse(
        resolveRecentUsageFreesAt(recent, limit - (percent - recent.percent) - need),
        () => now + ADMISSION_LIMITS.recheckMs
      );
  return Option.some({ fits, need, limit, percent, freesAt: Math.max(freesAt, now + MINUTE_MS) });
}

export function resolveAdmissionRoom(
  state: ShinsaState,
  provider: string,
  now: number,
  priority: TaskPriority = 'normal'
) {
  return Option.map(resolveAdmissionPace(state, provider, priority, now), (pace) => {
    const used =
      resolveRecentUsage(state, now, { provider }).percent + resolveCommitted(state, provider, null);
    return pace * (1 - ADMISSION_LIMITS.reserve) - used;
  });
}
