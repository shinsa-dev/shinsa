import { afterEach, describe, expect, it, jest } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ConnectionStatus, RECONNECT_GRACE_MS } from '@/components/status/connection-status.tsx';
import {
  connection,
  replaceConnection,
  type Snapshot,
  type ConnectionStatus as Status,
} from '@/lib/connection/socket.ts';

function installStatus(initial: Status) {
  const local = connection;
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = { state: null, status: initial };
  replaceConnection({
    ...local,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => snapshot,
  });
  return (status: Status) => {
    snapshot = { state: null, status };
    for (const listener of listeners) listener();
  };
}

function renderStatus() {
  render(
    <TooltipProvider>
      <ConnectionStatus />
    </TooltipProvider>
  );
}

afterEach(() => {
  cleanup();
  replaceConnection(null);
  jest.useRealTimers();
});

describe('ConnectionStatus', () => {
  it('shows nothing while connected', () => {
    installStatus('open');
    renderStatus();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hides a reconnect that recovers within the grace', () => {
    jest.useFakeTimers();
    const update = installStatus('open');
    renderStatus();
    act(() => update('closed'));
    act(() => jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1));
    act(() => update('open'));
    act(() => jest.advanceTimersByTime(RECONNECT_GRACE_MS));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows Reconnecting once the connection stays down past the grace, and hides it on reconnect', () => {
    jest.useFakeTimers();
    const update = installStatus('open');
    renderStatus();
    act(() => update('closed'));
    act(() => jest.advanceTimersByTime(RECONNECT_GRACE_MS));
    expect(screen.getByRole('status', { name: 'Reconnecting' })).toBeTruthy();
    act(() => update('open'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
