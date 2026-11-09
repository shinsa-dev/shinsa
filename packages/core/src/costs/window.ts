import type { Task, UsagePaceScope } from '../domain/index.ts';
import { DAY_MS } from '../domain/time.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveUsageRates, resolveWindowProvider } from './rate.ts';

export const RECENT_USAGE_MS = DAY_MS;

export interface UsageSpend {
  at: number;
  percent: number;
  taskId: string;
  projectId: string | null;
  window: string;
  provider: string;
}

export interface RecentUsageScope {
  provider: string;
  projectId?: string | null;
}

export interface RecentUsage {
  from: number;
  to: number;
  percent: number;
  spends: UsageSpend[];
  unmetered: number;
}

export interface PaceHold {
  scope: UsagePaceScope;
  limit: number;
  percent: number;
  projectId: string | null;
  freesAt: number;
}

export function listRecentSpends(state: ShinsaState, now: number) {
  const from = now - RECENT_USAGE_MS;
  const rates = resolveUsageRates(state.runs, state.accountPlans);
  const spends: UsageSpend[] = [];
  let unmetered = 0;
  for (const run of Object.values(state.runs)) {
    for (const meter of run.meters ?? []) {
      if (meter.to <= from || meter.to > now) continue;
      const rate = rates.get(meter.window);
      if (!rate || meter.usage.costUsd === null) {
        unmetered += 1;
        continue;
      }
      spends.push({
        at: meter.to,
        percent: meter.usage.costUsd * rate.percentPerUsd,
        taskId: run.taskId,
        projectId: state.tasks[run.taskId]?.projectId ?? null,
        window: meter.window,
        provider: resolveWindowProvider(meter.window),
      });
    }
  }
  return { spends: spends.sort((a, b) => a.at - b.at), unmetered };
}

export function resolveRecentUsage(state: ShinsaState, now: number, scope: RecentUsageScope): RecentUsage {
  const listed = listRecentSpends(state, now);
  const projectId = scope.projectId ?? null;
  const spends = listed.spends.filter(
    (spend) => spend.provider === scope.provider && (projectId === null || spend.projectId === projectId)
  );
  return {
    from: now - RECENT_USAGE_MS,
    to: now,
    percent: spends.reduce((total, spend) => total + spend.percent, 0),
    spends,
    unmetered: listed.unmetered,
  };
}

export function resolveRecentUsageFreesAt(recent: RecentUsage, limit: number) {
  let percent = recent.percent;
  if (percent < limit) return null;
  const freeing =
    recent.spends.find((spend) => {
      percent -= spend.percent;
      return percent < limit;
    }) ?? recent.spends.at(-1);
  return freeing ? freeing.at + RECENT_USAGE_MS : null;
}

function resolveScopeHold(
  recent: RecentUsage,
  scope: UsagePaceScope,
  limit: number | null | undefined,
  projectId: string | null
): PaceHold | null {
  if (limit === null || limit === undefined) return null;
  const freesAt = resolveRecentUsageFreesAt(recent, limit);
  return freesAt === null ? null : { scope, limit, percent: recent.percent, projectId, freesAt };
}

export function resolvePaceHold(
  state: ShinsaState,
  task: Task,
  provider: string,
  now: number
): PaceHold | null {
  if (task.paceLimitsIgnored) return null;
  const daily = state.settings.dailyUsageLimit;
  const projectId = task.projectId ?? null;
  const project = projectId === null ? null : (state.projects[projectId] ?? null);
  if ((daily === null || daily === undefined) && !project?.usageLimit) return null;
  const holds = [
    resolveScopeHold(resolveRecentUsage(state, now, { provider }), 'daily', daily, null),
    project
      ? resolveScopeHold(
          resolveRecentUsage(state, now, { provider, projectId: project.id }),
          'project',
          project.usageLimit,
          project.id
        )
      : null,
  ].filter((hold) => hold !== null);
  return holds.sort((a, b) => b.freesAt - a.freesAt)[0] ?? null;
}
