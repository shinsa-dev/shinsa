import { afterEach, describe, expect, it } from 'bun:test';
import { serializeShareMessage } from '@shinsa/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import { TeamTaskPage } from '@/routes/team-task.tsx';
import { createSharedTask } from '../lib/share/fixtures.ts';
import { createTeamFeedTask, FakeTeamSocket } from '../lib/teams/machine.ts';
import { pushTeams, startFakeServer, stopFakeServer } from '../support/server.ts';
import { createTask } from '../support/state.ts';

const ORIGINAL_SOCKET = globalThis.WebSocket;

const TARGET = { teamId: 'team1', instanceId: 'p7m2', taskId: 'kai-task' };

afterEach(() => {
  globalThis.WebSocket = ORIGINAL_SOCKET;
});

function openRelay() {
  const sockets: FakeTeamSocket[] = [];
  globalThis.WebSocket = function createFakeSocket(url: string) {
    const socket = new FakeTeamSocket(url, () => Promise.resolve(), false);
    sockets.push(socket);
    return socket;
  } as unknown as typeof WebSocket;
  render(<TeamTaskPage target={TARGET} />);
  return sockets;
}

describe('a teammate’s task in the local app', () => {
  it('opens the engine’s relay and shows the task read-only, with the standard preset’s chat', async () => {
    const sockets = openRelay();
    expect(screen.getByText('Opening the team task')).toBeDefined();
    expect(sockets[0]?.url).toEndWith('/api/teams/view?team=team1&machine=p7m2&task=kai-task');
    const shared = createSharedTask({
      task: createTask({ id: 'kai-task', title: 'Add the billing page', stage: 'building' }),
      owner: 'kai',
    });
    act(() =>
      sockets[0]?.emit('message', {
        data: serializeShareMessage({ t: 'view', data: JSON.stringify({ shared, files: {}, updatedAt: 1 }) }),
      })
    );
    await waitFor(() => expect(screen.getAllByText('Add the billing page').length).toBeGreaterThan(0));
    expect(screen.getByText('Read-only')).toBeDefined();
    expect(screen.getByRole('tab', { name: /Chat/ })).toBeDefined();
  });

  it('says the task is no longer shown to the team once its machine stops showing it', async () => {
    const sockets = openRelay();
    act(() =>
      sockets[0]?.emit('message', {
        data: serializeShareMessage({ t: 'closed', reason: 'Not shown any more.' }),
      })
    );
    await waitFor(() => expect(screen.getByText('This task is not shown to your team')).toBeDefined());
    expect(screen.getByText('Not shown any more.')).toBeDefined();
  });
});

describe('a teammate’s task while their machine is offline', () => {
  afterEach(stopFakeServer);

  const OFFLINE = {
    teamId: 'team1',
    instanceId: 'p7m2',
    name: 'Studio',
    userId: '7',
    status: 'offline' as const,
    reason: 'Offline.',
    updatedAt: Date.now() - 60_000,
  };

  it('opens the full copy this machine kept, marked as a copy from before their machine went offline', async () => {
    startFakeServer();
    pushTeams({ machines: [OFFLINE], tasks: [createTeamFeedTask()] });
    const sockets = openRelay();
    expect(screen.getByText('Opening the team task')).toBeDefined();
    const shared = createSharedTask({
      task: createTask({ id: 'kai-task', title: 'Add the billing page', stage: 'building' }),
      owner: 'kai',
    });
    act(() =>
      sockets[0]?.emit('message', {
        data: serializeShareMessage({ t: 'view', data: JSON.stringify({ shared, files: {}, updatedAt: 1 }) }),
      })
    );
    await waitFor(() =>
      expect(screen.getByText('Read-only copy from before their machine went offline')).toBeDefined()
    );
    expect(screen.getByRole('tab', { name: /Chat/ })).toBeDefined();
  });

  it('shows the task’s summary from its list when this machine kept no full copy', async () => {
    startFakeServer();
    pushTeams({ machines: [OFFLINE], tasks: [createTeamFeedTask()] });
    const sockets = openRelay();
    act(() =>
      sockets[0]?.emit('message', {
        data: serializeShareMessage({ t: 'closed', reason: 'The teammate’s machine is offline.' }),
      })
    );
    await waitFor(() => expect(screen.getByText(/machine is offline, and this machine kept/)).toBeDefined());
    expect(screen.getByRole('link', { name: 'kai’s' }).getAttribute('href')).toBe('https://github.com/kai');
    expect(screen.getByText('Add the billing page')).toBeDefined();
    expect(screen.getByText('Offline')).toBeDefined();
  });
});
