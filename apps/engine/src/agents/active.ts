import type { RunAccount } from '@shinsa/core';
import type { AccountLease } from './accounts.ts';
import type { RunClock } from './clock.ts';
import type { Delivery } from './delegations.ts';
import type { AgentSession } from './providers/index.ts';

export interface ActiveRun {
  taskId: string;
  done: Promise<void>;
  session: AgentSession | null;
  clock: RunClock | null;
  attemptId: string | null;
  attempts: number;
  lease: AccountLease | null;
  rejected: string[];
  renewed: string[];
  renewing: RunAccount | null;
  overloads: number;
  wake: (() => void) | null;
  steerable: boolean;
  leaseSpent: boolean;
  stopping: boolean;
  queued: string[];
  unsent: string[];
  resteered: string[];
  unsteered: string[];
  delegated: boolean;
  delivery: Delivery | null;
  held: Delivery[];
  steered: Map<string, string[]>;
  released: boolean;
}

export function createActiveRun(
  taskId: string,
  done: Promise<void>,
  options: Pick<ActiveRun, 'steerable' | 'delegated' | 'delivery'>
): ActiveRun {
  return {
    taskId,
    done,
    session: null,
    clock: null,
    attemptId: null,
    attempts: 0,
    lease: null,
    rejected: [],
    renewed: [],
    renewing: null,
    overloads: 0,
    wake: null,
    leaseSpent: false,
    stopping: false,
    queued: [],
    unsent: [],
    resteered: [],
    unsteered: [],
    held: [],
    steered: new Map(),
    released: false,
    ...options,
  };
}

export function resolveAttemptKey(runId: string, attemptId: string | null) {
  return attemptId ?? `${runId}:0`;
}

export function isSteerable(active: ActiveRun) {
  return active.steerable && !active.stopping && !active.leaseSpent;
}

export function carryUndelivered(active: ActiveRun, undelivered: string[] | undefined) {
  for (const text of undelivered ?? []) {
    if (active.steered.has(text)) active.resteered.push(text);
    else active.queued.push(text);
  }
}

export function waitToRetry(active: ActiveRun, ms: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  const wake = () => {
    clearTimeout(timer);
    active.wake = null;
    resolve();
  };
  const timer = setTimeout(wake, ms);
  active.wake = wake;
  return promise;
}

export function stopActiveRun(active: ActiveRun) {
  active.stopping = true;
  active.wake?.();
}
