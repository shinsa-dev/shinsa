import * as React from 'react';
import { requestJson } from '@/lib/connection/http.ts';
import { type Connection, connection } from '@/lib/connection/socket.ts';
import { createSignal } from '@/lib/signal.ts';

export interface LogProblem {
  seq: number;
  type: string;
  kind: 'unreadable' | 'unappliable';
  error: string;
}

export interface ServerHealth {
  ok: boolean;
  seq: number;
  problems: LogProblem[];
  version?: string;
  protocol?: number;
  busy?: boolean;
  restart?: 'idle' | null;
  dataDir?: string;
}

export interface HealthBannerView {
  text: string;
  problems: { key: string; label: string; detail: string }[];
}

export const HEALTH_COPY = {
  details: 'Details',
  title: 'Damaged log entries',
  description: 'Shinsa logged each one as an error and applied every entry after it.',
  dismiss: 'Dismiss',
};

const PROBLEM_KIND: Record<LogProblem['kind'], string> = {
  unreadable: 'Unreadable',
  unappliable: 'Not applied',
};

const signal = createSignal();

let health: ServerHealth | null = null;

let dismissed: string | null = null;

function publish() {
  signal.publish();
}

async function readHealth() {
  try {
    return await requestJson<ServerHealth>('/api/health');
  } catch {
    return health;
  }
}

export async function refreshHealth() {
  health = await readHealth();
  publish();
}

function resolveProblemsKey(problems: LogProblem[]) {
  return problems.map((problem) => `${problem.seq}:${problem.kind}`).join(',');
}

export function dismissHealth() {
  dismissed = resolveProblemsKey(health?.problems ?? []);
  publish();
}

function describeSkippedEntries(count: number) {
  const entries = count === 1 ? 'a damaged entry' : `${count} damaged entries`;
  return `Shinsa skipped ${entries} in its log at start. Everything else loaded.`;
}

export function resolveHealthBanner(
  current: ServerHealth | null,
  dismissedKey: string | null
): HealthBannerView | null {
  if (!current || current.ok) return null;
  if (dismissedKey === resolveProblemsKey(current.problems)) return null;
  return {
    text: describeSkippedEntries(current.problems.length),
    problems: current.problems.map((problem) => ({
      key: `${problem.seq}-${problem.kind}`,
      label: `Entry ${problem.seq} · ${problem.type || 'unknown event'}`,
      detail: PROBLEM_KIND[problem.kind],
    })),
  };
}

export function watchHealth(source: Pick<Connection, 'subscribe' | 'snapshot'> = connection) {
  let open = source.snapshot().status === 'open';
  void refreshHealth();
  return source.subscribe(() => {
    const now = source.snapshot().status === 'open';
    if (now && !open) void refreshHealth();
    open = now;
  });
}

export function useServerHealth() {
  return React.useSyncExternalStore(signal.subscribe, () => health);
}

export function useHealthBanner() {
  React.useEffect(() => watchHealth(), []);
  const current = React.useSyncExternalStore(signal.subscribe, () => health);
  const dismissedKey = React.useSyncExternalStore(signal.subscribe, () => dismissed);
  return React.useMemo(() => resolveHealthBanner(current, dismissedKey), [current, dismissedKey]);
}
