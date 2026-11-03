import { Effect, Schema } from 'effect';
import * as React from 'react';
import { type Connection, connection } from '@/lib/connection/socket.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSignal } from '@/lib/signal.ts';
import { type LogProblem, ServerHealth } from './schema.ts';

export type { LogProblem, ServerHealth } from './schema.ts';

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

const DISMISSED_KEY = 'shinsa.health-dismissed';

const signal = createSignal();

let health: ServerHealth | null = null;

function publish() {
  signal.publish();
}

const decodeHealth = Schema.decodeUnknownEffect(ServerHealth);

export const syncHealth = Effect.gen(function* () {
  const engine = yield* EngineClient;
  health = yield* decodeHealth(yield* engine.server.health());
}).pipe(Effect.ignore, Effect.andThen(Effect.sync(publish)));

export function refreshHealth() {
  return runApp(syncHealth);
}

function resolveProblemsKey(problems: readonly LogProblem[]) {
  return problems.map((problem) => `${problem.seq}:${problem.kind}`).join(',');
}

function readDismissedKey() {
  return localStorage.getItem(DISMISSED_KEY);
}

export function dismissHealth() {
  localStorage.setItem(DISMISSED_KEY, resolveProblemsKey(health?.problems ?? []));
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
  const dismissedKey = React.useSyncExternalStore(signal.subscribe, readDismissedKey);
  return React.useMemo(() => resolveHealthBanner(current, dismissedKey), [current, dismissedKey]);
}
