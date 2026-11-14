import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoveDialog } from '@/components/task/move-dialog.tsx';
import { closeMoveDialog, openMoveDialog } from '@/lib/tasks/move.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createRepo, createShinsaState, createTask } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

beforeEach(() => {
  startFakeServer();
  pushState(
    createShinsaState({
      tasks: [createTask({ id: 't', handle: 'LOC-1', repoId: 'engine', projectId: 'shinsa' })],
      projects: [
        createProject({ id: 'shinsa', name: 'Shinsa' }),
        createProject({ id: 'apps', name: 'Apps' }),
      ],
      repos: [
        createRepo({ id: 'engine', name: 'shinsa', projectId: 'shinsa' }),
        createRepo({ id: 'ios', name: 'Shinsa-iOS', projectId: 'shinsa' }),
        createRepo({ id: 'islands', name: 'islands', projectId: 'apps' }),
      ],
    })
  );
});

afterEach(() => {
  act(() => closeMoveDialog());
  stopFakeServer();
});

describe('the move dialog', () => {
  it('finds a repository in another project and moves the task there', async () => {
    render(<MoveDialog />);
    act(() => openMoveDialog('t'));
    const search = await screen.findByPlaceholderText('Find a repository');
    expect(screen.getByText('Shinsa-iOS')).toBeTruthy();
    expect(screen.getByText('Moves to Apps')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'apps' } });
    await waitForGone(() => screen.queryByText('Shinsa-iOS'));
    fireEvent.click(screen.getByText('islands'));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'task.move_to_repository', taskId: 't', repoId: 'islands' },
      ])
    );
    await waitForGone(() => screen.queryByText('Move to another repository'));
  });

  it('opens for no task it does not know', () => {
    render(<MoveDialog />);
    act(() => openMoveDialog('gone'));
    expect(screen.queryByText('Move to another repository')).toBeNull();
  });
});
