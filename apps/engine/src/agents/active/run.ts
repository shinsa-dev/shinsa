import { type ActiveRun } from './schema.ts';

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
