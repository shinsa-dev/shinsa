import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ForkDialog } from '@/components/task/fork-dialog.tsx';
import { connection, replaceConnection } from '@/lib/connection/socket.ts';
import { closeForkDialog, openForkDialog } from '@/lib/tasks/fork.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createRepo, createShinsaState, createTask } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

beforeEach(() => {
  startFakeServer();
  pushState(
    createShinsaState({
      tasks: [createTask({ id: 'source', handle: 'SW-2', stage: 'merged', repoId: 'r1' })],
      repos: [createRepo({ id: 'r1', projectId: 'p1' })],
    })
  );
});

afterEach(() => {
  act(() => closeForkDialog());
  replaceConnection(null);
  stopFakeServer();
});

describe('the fork dialog', () => {
  it('forks the task into a new one with the request you write, in the same repository and project', async () => {
    render(<ForkDialog />);
    act(() => openForkDialog('source'));
    expect(await screen.findByText('Fork into a new task')).toBeTruthy();
    const fork = screen.getByRole('button', { name: 'Fork' }) as HTMLButtonElement;
    expect(fork.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'What the new task should do' }), {
      target: { value: 'Fix the paywall in Safari' },
    });
    fireEvent.click(fork);
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        {
          type: 'task.create',
          request: 'Fix the paywall in Safari',
          repoId: 'r1',
          projectId: 'p1',
          forkOf: 'source',
        },
      ])
    );
    await waitForGone(() => screen.queryByText('Fork into a new task'));
  });

  it('opens for no task it does not know, and closes on cancel', async () => {
    render(<ForkDialog />);
    act(() => openForkDialog('gone'));
    expect(screen.queryByText('Fork into a new task')).toBeNull();
    act(() => openForkDialog('source'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitForGone(() => screen.queryByText('Fork into a new task'));
  });
});

const KAI = { id: 'u2', login: 'kai', name: 'Kai', avatarUrl: null };

const KAI_MACHINE = {
  id: 'kai',
  name: 'Kai’s MacBook',
  current: false,
  teammate: { owner: KAI, viewerId: 'u1' },
};

const STUDIO = { id: 'studio', name: 'Studio', current: true };

function teammateState(repos: ReturnType<typeof createRepo>[]) {
  pushState({
    ...createShinsaState({
      tasks: [createTask({ id: 'kai-task', handle: 'PAY-1', repoId: 'kai-repo' })],
      repos: [createRepo({ id: 'kai-repo', name: 'pay', remote: 'github.com/acme/pay' }), ...repos],
    }),
    teammateRepos: { 'kai-repo': true },
  });
  const local = connection;
  replaceConnection({
    ...local,
    command: (command, machineId) => local.command(command, machineId),
    subscribe: (listener) => local.subscribe(listener),
    selectMachine: (id: string) => {
      if (id === 'kai-task') return KAI_MACHINE;
      return id === 'kai-repo' ? null : STUDIO;
    },
  });
}

describe('the fork dialog for a teammate’s task', () => {
  it('forks onto your repository with the same remote, and lets you pick another', async () => {
    teammateState([
      createRepo({ id: 'pay', name: 'pay', remote: 'github.com/acme/pay' }),
      createRepo({ id: 'site', name: 'site', remote: null }),
    ]);
    render(<ForkDialog />);
    act(() => openForkDialog('kai-task'));
    expect(await screen.findByText(/from what Kai’s task was asked and did/)).toBeTruthy();
    const picker = screen.getByRole('combobox', { name: 'Repository' });
    expect(picker.textContent).toBe('pay');
    fireEvent.click(picker);
    const site = await screen.findByRole('option', { name: 'site' });
    fireEvent.pointerDown(site, { pointerType: 'mouse' });
    fireEvent.click(site);
    await waitFor(() => expect(picker.textContent).toBe('site'));
    fireEvent.change(screen.getByRole('textbox', { name: 'What the new task should do' }), {
      target: { value: 'Retry twice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    await waitFor(() =>
      expect(listSentCommands()).toMatchObject([
        { type: 'task.create', request: 'Retry twice', repoId: 'site', teammateFork: { taskId: 'kai-task' } },
      ])
    );
  });

  it('asks for a repository of yours first when you have none', async () => {
    teammateState([]);
    render(<ForkDialog />);
    act(() => openForkDialog('kai-task'));
    expect(await screen.findByText(/Add this repository on one of your machines first/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'What the new task should do' }), {
      target: { value: 'Retry twice' },
    });
    expect((screen.getByRole('button', { name: 'Fork' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
