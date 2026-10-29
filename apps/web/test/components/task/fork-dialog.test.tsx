import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ForkDialog } from '@/components/task/fork-dialog.tsx';
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
