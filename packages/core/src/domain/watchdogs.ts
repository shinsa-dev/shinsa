import type { WatchdogSource, WatchdogSourceRequest } from '../report/types.ts';

export type WatchdogStatus = 'needs_source' | 'watching' | 'passed' | 'tripped' | 'stopped';

export interface WatchdogCheck {
  at: number;
  healthy: boolean;
  summary: string;
}

export interface Watchdog {
  id: string;
  round: number;
  title: string;
  check: string;
  source: WatchdogSource | null;
  sourceRequest: WatchdogSourceRequest | null;
  everyMinutes: number;
  forMinutes: number;
  status: WatchdogStatus;
  armedAt: number;
  startedAt: number | null;
  endsAt: number | null;
  nextCheckAt: number | null;
  runId: string | null;
  checks: WatchdogCheck[];
  forkTaskId: string | null;
  endedAt: number | null;
}

export interface WatchSource {
  server: string;
  data: string;
  repoIds: string[];
  addedBy: 'you' | 'agent';
  addedAt: number;
}

export const WATCHDOG_LIMITS = {
  checksKept: 20,
  deferMinutes: 15,
  projectSources: 20,
} as const;

const ACTIVE_WATCHDOG_STATUSES: ReadonlySet<WatchdogStatus> = new Set<WatchdogStatus>([
  'needs_source',
  'watching',
]);

export function isWatchdogActive(watchdog: Pick<Watchdog, 'status'>) {
  return ACTIVE_WATCHDOG_STATUSES.has(watchdog.status);
}

export function listActiveWatchdogs(task: { watchdogs?: Watchdog[] }) {
  return (task.watchdogs ?? []).filter(isWatchdogActive);
}

export function selectWatchingRun(task: { watchdogs?: Watchdog[] }, runId: string) {
  return (task.watchdogs ?? []).find((watchdog) => watchdog.runId === runId) ?? null;
}

export function isSourceForRepo(source: Pick<WatchSource, 'repoIds'>, repoId: string | null) {
  return source.repoIds.length === 0 || (repoId !== null && source.repoIds.includes(repoId));
}

export function listRepoWatchSources(
  project: { watchSources?: WatchSource[] } | null | undefined,
  repoId: string | null
) {
  return (project?.watchSources ?? []).filter((source) => isSourceForRepo(source, repoId));
}
