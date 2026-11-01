import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskMenu } from '@/components/task/menu.tsx';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import {
  listSentCommands,
  pushAccounts,
  pushState,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

beforeEach(() => {
  startFakeServer();
  pushAccounts(
    createSnapshot({
      accounts: [
        createAccount({ id: 'a' }),
        createAccount({ id: 'b' }),
        createAccount({ id: 'c', signIn: 'signed_out' }),
      ],
    })
  );
});

afterEach(() => {
  stopFakeServer();
});

function renderMenu(task: Task) {
  const state = createShinsaState({ tasks: [task] });
  pushState(state);
  return render(
    <TooltipProvider>
      <TaskMenu state={state} task={task} />
    </TooltipProvider>
  );
}

describe('Run on account in the task menu', () => {
  it('binds the task from the task menu', async () => {
    renderMenu(createTask({ id: 't' }));
    fireEvent.click(screen.getByRole('button', { name: 'Task actions' }));
    const trigger = await screen.findByRole('menuitem', { name: 'Run on account' });
    await act(async () => {
      fireEvent.pointerEnter(trigger);
      fireEvent.mouseEnter(trigger);
      fireEvent.pointerMove(trigger);
      fireEvent.mouseMove(trigger);
    });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'a@example.com' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'task.bind_account', taskId: 't', account: { id: 'a', email: 'a@example.com' } },
      ])
    );
  });

  it('is left out of a finished task', async () => {
    renderMenu(createTask({ id: 't', stage: 'merged', branch: 'feat/x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Task actions' }));
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Run on account' })).toBeNull();
  });
});

describe('Stack on another task in the task menu', () => {
  async function openSubmenu(name: string) {
    const trigger = await screen.findByRole('menuitem', { name });
    await act(async () => {
      fireEvent.pointerEnter(trigger);
      fireEvent.mouseEnter(trigger);
      fireEvent.pointerMove(trigger);
      fireEvent.mouseMove(trigger);
    });
  }

  it('stacks the task on the one you tick', async () => {
    const task = createTask({ id: 't', stage: 'planning', stacksOn: 'p' });
    const parent = createTask({ id: 'p', title: 'Add the schema' });
    const other = createTask({ id: 'o', title: 'Add the API' });
    const state = createShinsaState({ tasks: [task, parent, other] });
    pushState(state);
    render(
      <TooltipProvider>
        <TaskMenu state={state} task={task} />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Task actions' }));
    await openSubmenu('Stack on another task');
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Add the API' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.stack_on', taskId: 't', stacksOn: 'o' }])
    );
  });

  it('takes the task out of its bundle', async () => {
    const task = createTask({ id: 't', stage: 'triage', stacksOn: 'p' });
    const state = createShinsaState({ tasks: [task, createTask({ id: 'p', title: 'Add the schema' })] });
    pushState(state);
    render(
      <TooltipProvider>
        <TaskMenu state={state} task={task} />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Task actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Take out of the bundle' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.stack_on', taskId: 't', stacksOn: null }])
    );
  });
});
