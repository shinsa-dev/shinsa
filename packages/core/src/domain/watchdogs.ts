import type { WatchdogSource, WatchdogSourceRequest, WatchdogStart } from '../report/types.ts';

export type WatchdogStatus =
  | 'needs_source'
  | 'awaiting_production'
  | 'watching'
  | 'passed'
  | 'tripped'
  | 'stopped';

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
  firstCheckMinutes: number;
  maxGapMinutes: number;
  forMinutes: number;
  startsOn: WatchdogStart;
  productionCheck: string | null;
  status: WatchdogStatus;
  armedAt: number;
  awaitingSince: number | null;
  startedAt: number | null;
  endsAt: number | null;
  nextCheckAt: number | null;
  runId: string | null;
  checks: WatchdogCheck[];
  forkTaskIds: string[];
  linkedTaskIds: string[];
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
  productionPollMinutes: 30,
  productionPollMaxMinutes: 360,
  productionWaitHours: 168,
} as const;

const ACTIVE_WATCHDOG_STATUSES: ReadonlySet<WatchdogStatus> = new Set<WatchdogStatus>([
  'needs_source',
  'awaiting_production',
  'watching',
]);

const SCHEDULED_WATCHDOG_STATUSES: ReadonlySet<WatchdogStatus> = new Set<WatchdogStatus>([
  'awaiting_production',
  'watching',
]);

export function isWatchdogScheduled(watchdog: Pick<Watchdog, 'status'>) {
  return SCHEDULED_WATCHDOG_STATUSES.has(watchdog.status);
}

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
