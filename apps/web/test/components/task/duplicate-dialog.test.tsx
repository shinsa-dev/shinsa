import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DuplicateDialog } from '@/components/task/duplicate-dialog.tsx';
import { closeDuplicateDialog, openDuplicateDialog } from '@/lib/tasks/duplicate.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

beforeEach(() => {
  startFakeServer();
  pushState(
    createShinsaState({
      tasks: [
        createTask({ id: 'copy', handle: 'SW-3', title: 'Dark theme please' }),
        createTask({ id: 'original', handle: 'SW-1', title: 'Add dark mode' }),
        createTask({ id: 'other', handle: 'SW-2', title: 'Fix the login button' }),
      ],
    })
  );
});

afterEach(() => {
  act(() => closeDuplicateDialog());
  stopFakeServer();
});

describe('the duplicate dialog', () => {
  it('finds the original by its title and closes the task as its duplicate', async () => {
    render(<DuplicateDialog />);
    act(() => openDuplicateDialog('copy'));
    const search = await screen.findByPlaceholderText('Find the task this one repeats');
    expect(screen.queryByText('Dark theme please')).toBeNull();
    fireEvent.change(search, { target: { value: 'dark mode' } });
    await waitForGone(() => screen.queryByText('Fix the login button'));
    fireEvent.click(screen.getByText('Add dark mode'));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'task.mark_duplicate', taskId: 'copy', duplicateOf: 'original' },
      ])
    );
    await waitForGone(() => screen.queryByText('Close as a duplicate'));
  });

  it('opens for no task it does not know', () => {
    render(<DuplicateDialog />);
    act(() => openDuplicateDialog('gone'));
    expect(screen.queryByText('Close as a duplicate')).toBeNull();
  });
});
