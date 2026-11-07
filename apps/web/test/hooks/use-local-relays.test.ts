import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useLocalRelays } from '@/hooks/use-local-relays.ts';
import { connection } from '@/lib/connection/socket.ts';

describe('useLocalRelays', () => {
  it('keeps the page on this machine until a teammate machine is relayed', () => {
    const before = connection;
    const { result, unmount } = renderHook(() => useLocalRelays());
    expect(result.current).toBe(0);
    expect(connection).toBe(before);
    unmount();
    expect(connection).toBe(before);
  });

  it('remounts the page each time it switches to a fleet, and stops on unmount', () => {
    let onSwitch: () => void = () => undefined;
    const stop = mock(() => undefined);
    const start = (given: () => void) => {
      onSwitch = given;
      return stop;
    };
    const { result, unmount } = renderHook(() => useLocalRelays(start));
    act(() => onSwitch());
    expect(result.current).toBe(1);
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
