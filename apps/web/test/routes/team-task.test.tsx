import { afterEach, describe, expect, it } from 'bun:test';
import { serializeShareMessage } from '@shinsa/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import { TeamTaskPage } from '@/routes/team-task.tsx';
import { createSharedTask } from '../lib/share/fixtures.ts';
import { FakeTeamSocket } from '../lib/teams/machine.ts';
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
  it('opens the engine’s relay and shows the task read-only, without its chat', async () => {
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
    expect(screen.queryByRole('tab', { name: /Chat/ })).toBeNull();
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
