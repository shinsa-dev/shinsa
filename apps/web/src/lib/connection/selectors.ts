import type { Gate, Run, ShinsaState, Task } from '@shinsa/core';
import { useRef, useSyncExternalStore } from 'react';
import { connection } from '@/lib/connection/socket.ts';

interface Selected<T> {
  state: ShinsaState | null;
  select: (state: ShinsaState) => T;
  value: T | null;
}

export function useShinsaSelector<T>(select: (state: ShinsaState) => T): T | null {
  const cache = useRef<Selected<T> | null>(null);
  const read = () => {
    const state = connection.snapshot().state;
    const cached = cache.current;
    if (cached && cached.state === state && cached.select === select) return cached.value;
    const value = state ? select(state) : null;
    if (cached && Object.is(cached.value, value)) {
      cache.current = { state, select, value: cached.value };
      return cached.value;
    }
    cache.current = { state, select, value };
    return value;
  };
  return useSyncExternalStore(connection.subscribe, read);
}

export function useShinsaState() {
  return useShinsaSelector((state) => state);
}

export function useTask(taskId: string | null): Task | null {
  return useShinsaSelector((state) => (taskId ? (state.tasks[taskId] ?? null) : null));
}

export function useRun(runId: string | null): Run | null {
  return useShinsaSelector((state) => (runId ? (state.runs[runId] ?? null) : null));
}

export function useGate(gateId: string | null): Gate | null {
  return useShinsaSelector((state) => (gateId ? (state.gates[gateId] ?? null) : null));
}
