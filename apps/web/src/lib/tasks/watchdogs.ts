import {
  HOUR_MS,
  isTaskClosed,
  listActiveWatchdogs,
  type ShinsaState,
  type Task,
  type Watchdog,
  type WatchdogStatus,
  type WatchSource,
} from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { formatCount } from '@/lib/format/count.ts';
import type { Tone } from '@/lib/format/tone.ts';

export const WATCHDOGS_TITLE = 'Watchdogs';

export const WATCHDOG_STATUS: Record<WatchdogStatus, { label: string; tone: Tone }> = {
  needs_source: { label: 'Needs a data source', tone: 'amber' },
  awaiting_production: { label: 'Waiting for production', tone: 'amber' },
  watching: { label: 'Watching', tone: 'blue' },
  passed: { label: 'Passed', tone: 'green' },
  tripped: { label: 'Found an issue', tone: 'red' },
  stopped: { label: 'Stopped', tone: 'neutral' },
};

function formatHours(ms: number) {
  return `${Math.max(1, Math.ceil(ms / HOUR_MS))} h`;
}

function formatMinutes(minutes: number) {
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

export function describeWatchdogSchedule(watchdog: Watchdog) {
  const start = watchdog.startsOn === 'production' ? ' once live in production' : '';
  return `First check after ${formatMinutes(watchdog.firstCheckMinutes)}, then up to every ${formatMinutes(watchdog.maxGapMinutes)}, for ${formatMinutes(watchdog.forMinutes)}${start}`;
}

export function describeWatchdogProgress(state: ShinsaState, watchdog: Watchdog, now: number) {
  const checks = formatCount(watchdog.checks.length, 'check', 'checks');
  switch (watchdog.status) {
    case 'needs_source':
      return 'Starts once you connect a data source.';
    case 'awaiting_production':
      if (watchdog.runId) return 'Checking whether the change is live in production.';
      return 'Starts once the change is live in production.';
    case 'watching':
      if (watchdog.runId) return `Checking now · ${checks} so far`;
      return `${formatHours((watchdog.endsAt ?? now) - now)} left · ${checks}`;
    case 'passed':
      return `Passed after ${checks}, nothing wrong.`;
    case 'tripped': {
      const fork = watchdog.forkTaskId ? state.tasks[watchdog.forkTaskId] : undefined;
      return fork
        ? `Filed [${fork.handle ?? fork.title}](shinsa://task/${fork.id}) to fix it.`
        : 'Found an issue.';
    }
    case 'stopped':
      return `Stopped after ${checks}.`;
  }
}

export function isWatchedTask(task: Task) {
  return task.stage === 'merged' && !isTaskClosed(task) && listActiveWatchdogs(task).length > 0;
}

export function resolveWatchingReason(task: Task, now: number) {
  if (isTaskClosed(task)) return null;
  const active = listActiveWatchdogs(task);
  if (active.length === 0) return null;
  const count = formatCount(active.length, 'watchdog', 'watchdogs');
  const ends = active.map((watchdog) => watchdog.endsAt).filter((at): at is number => at !== null);
  if (ends.length === 0) {
    const waiting = active.some((watchdog) => watchdog.status === 'awaiting_production');
    return `${count} · ${waiting ? 'waiting for production' : 'waiting for a data source'}`;
  }
  return `${count} · ${formatHours(Math.max(...ends) - now)} left`;
}

export function stopWatchdog(task: Task, watchdog: Watchdog) {
  return sendCommandWithToast(
    { type: 'watchdog.stop', taskId: task.id, watchdogId: watchdog.id },
    `Stopped the watchdog “${watchdog.title}”.`
  );
}

export function connectWatchdog(task: Task, watchdog: Watchdog, server: string, data: string) {
  return sendCommandWithToast(
    { type: 'watchdog.connect', taskId: task.id, watchdogId: watchdog.id, server, data },
    `Connected ${server.trim()}. The watchdog starts watching.`
  );
}

export const WATCH_SOURCE_HINT = 'A data source watchdogs read after a merge';

export function describeWatchSource(state: ShinsaState, source: WatchSource) {
  const repos = source.repoIds.map((id) => state.repos[id]?.name ?? id);
  const scope = repos.length === 0 ? 'every repository' : repos.join(', ');
  const added = source.addedBy === 'agent' ? ', added by an agent' : '';
  return `${source.data} · ${scope}${added}`;
}

export function removeWatchSource(projectId: string, server: string) {
  return sendCommandWithToast(
    { type: 'watch_source.remove', projectId, server },
    `Removed ${server} from the data sources.`
  );
}
