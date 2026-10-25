import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { ShinsaState } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import { useGate, useRun, useShinsaSelector, useShinsaState, useTask } from '@/lib/connection/selectors.ts';
import { connection } from '@/lib/connection/socket.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

function fakeStore(initial: ShinsaState | null) {
  let current = { state: initial, status: 'open' as const };
  const listeners = new Set<() => void>();
  const subscribe = spyOn(connection, 'subscribe').mockImplementation((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const snapshot = spyOn(connection, 'snapshot').mockImplementation(() => current);
  return {
    push(state: ShinsaState | null) {
      act(() => {
        current = { ...current, state };
        for (const listener of listeners) listener();
      });
    },
    restore() {
      subscribe.mockRestore();
      snapshot.mockRestore();
    },
  };
}

const stores: ReturnType<typeof fakeStore>[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.restore();
});

describe('selectors', () => {
  it('give nothing before the first state', () => {
    stores.push(fakeStore(null));
    expect(renderHook(() => useShinsaState()).result.current).toBeNull();
    expect(renderHook(() => useTask('t1')).result.current).toBeNull();
  });

  it('keep what they selected while the state changes elsewhere, and follow it when it changes', () => {
    const task = createTask({ id: 't1' });
    const state = createShinsaState({ tasks: [task, createTask({ id: 't2' })] });
    const store = fakeStore(state);
    stores.push(store);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useTask('t1');
    });
    expect(result.current).toBe(task);
    const before = renders;
    store.push({
      ...state,
      seq: 9,
      tasks: { ...state.tasks, t2: createTask({ id: 't2', title: 'Changed' }) },
    });
    expect(result.current).toBe(task);
    expect(renders).toBe(before);
    const changed = createTask({ id: 't1', title: 'Renamed' });
    store.push({ ...state, seq: 10, tasks: { ...state.tasks, t1: changed } });
    expect(result.current).toBe(changed);
  });

  it('read a run, a gate, a task that is not there and none at all', () => {
    const run = createRun({ id: 'r1', taskId: 't1' });
    const gate = createGate({ id: 'g1', taskId: 't1' });
    const state = createShinsaState({ runs: [run], gates: [gate] });
    stores.push(fakeStore(state));
    expect(renderHook(() => useShinsaState()).result.current).toBe(state);
    expect(renderHook(() => useRun('r1')).result.current).toBe(run);
    expect(renderHook(() => useGate('g1')).result.current).toBe(gate);
    expect(renderHook(() => useRun('missing')).result.current).toBeNull();
    expect(renderHook(() => useGate('missing')).result.current).toBeNull();
    expect(renderHook(() => useTask('missing')).result.current).toBeNull();
    expect(renderHook(() => useTask(null)).result.current).toBeNull();
    expect(renderHook(() => useRun(null)).result.current).toBeNull();
    expect(renderHook(() => useGate(null)).result.current).toBeNull();
  });

  it('compute a derived value again only when the state changes', () => {
    const state = createShinsaState({ tasks: [createTask({ id: 't1' })] });
    const store = fakeStore(state);
    stores.push(store);
    let computed = 0;
    const select = (current: ShinsaState) => {
      computed += 1;
      return Object.keys(current.tasks);
    };
    const { result, rerender } = renderHook(() => useShinsaSelector(select));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    const count = computed;
    store.push({ ...state, seq: 2 });
    expect(computed).toBeGreaterThan(count);
    expect(result.current).toEqual(['t1']);
  });
});
