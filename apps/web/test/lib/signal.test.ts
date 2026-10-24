import { describe, expect, it, mock } from 'bun:test';
import { createSignal } from '@/lib/signal.ts';

describe('createSignal', () => {
  it('notifies every subscriber on publish', () => {
    const signal = createSignal();
    const first = mock(() => {});
    const second = mock(() => {});
    signal.subscribe(first);
    signal.subscribe(second);
    signal.publish();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops notifying a listener after it unsubscribes', () => {
    const signal = createSignal();
    const listener = mock(() => {});
    const unsubscribe = signal.subscribe(listener);
    unsubscribe();
    signal.publish();
    expect(listener).not.toHaveBeenCalled();
  });
});
