import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { Task, TriageDecisions } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskFacts } from '@/components/task/facts.tsx';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { findTooltipText } from '../../support/hover.ts';
import { createRound } from '../../support/rounds.ts';
import {
  listSentCommands,
  pushAccounts,
  pushState,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createRun, createShinsaState, createTask } from '../../support/state.ts';

const DECIDED: TriageDecisions = {
  shape: { value: 'answer', why: 'It asks how something works.' },
  start: null,
  priority: { value: 'normal', why: 'Nothing is waiting on it.' },
};

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  startFakeServer();
  toasts = spyOnToasts();
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
  toasts.restore();
  stopFakeServer();
});

function renderFacts(task: Task = createTask({ id: 't', handle: 'SW-7' }), others: Task[] = []) {
  const state = createShinsaState({ tasks: [task, ...others] });
  pushState(state);
  return render(
    <TooltipProvider>
      <TaskFacts state={state} task={task} />
    </TooltipProvider>
  );
}

describe('the handle fact', () => {
  it('copies the handle and says “Copied” in a toast', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderFacts();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy SW-7' }));
    });
    expect(write).toHaveBeenCalledWith('SW-7');
    expect(toasts.success).toHaveBeenCalledWith('Copied');
    write.mockRestore();
  });

  it('says it could not copy when the clipboard refuses', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderFacts();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy SW-7' }));
    });
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t copy to the clipboard');
    write.mockRestore();
  });
});

describe('what Shinsa decided, in the facts', () => {
  function decided(overrides: Partial<Task> = {}) {
    return createTask({
      id: 't',
      stage: 'answering',
      pipeline: ['answer'],
      triageDecisions: DECIDED,
      ...overrides,
    });
  }

  it('leaves the kind of task out: the task itself shows it', () => {
    const view = renderFacts(decided());
    expect(view.queryByText('Answer only')).toBeNull();
    expect(view.getByText('Answering')).toBeTruthy();
  });

  it('gives the priority Shinsa’s reason, and changes it in one click', async () => {
    const view = renderFacts(decided());
    const priority = view.getByRole('button', { name: 'Normal' });
    expect(await findTooltipText(priority)).toBe('Shinsa chose this: Nothing is waiting on it.');
    fireEvent.click(priority);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Urgent' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.prioritize', taskId: 't', priority: 'urgent' }])
    );
  });

  it('reads a fact you changed as yours', async () => {
    const view = renderFacts(decided({ stage: 'building', pipeline: undefined, priority: 'high' }));
    expect(await findTooltipText(view.getByRole('button', { name: 'High' }))).toBe(
      'You changed this. Shinsa chose “normal priority”: Nothing is waiting on it.'
    );
  });

  it('puts why a task waits on its Waits on fact, which starts it now', async () => {
    const base = createTask({ id: 'base', title: 'Fix the schema' });
    const task = decided({
      stage: 'waiting_on_tasks',
      waitsOn: ['base'],
      triageDecisions: { ...DECIDED, start: { value: ['base'], why: 'It reads the same table.' } },
    });
    const view = renderFacts(task, [base]);
    const waits = view.getByRole('button', { name: 'Waits on Fix the schema' });
    expect(await findTooltipText(waits)).toBe('Shinsa chose this: It reads the same table.');
    fireEvent.click(waits);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop waiting' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.wait_on', taskId: 't', waitsOn: [] }])
    );
  });

  it('puts why a task started at once on when it started', async () => {
    const task = decided({
      triageDecisions: { ...DECIDED, start: { value: [], why: 'Nothing it reads is changing.' } },
    });
    const view = renderFacts(task);
    expect(await findTooltipText(view.getByText(/^Started/))).toContain(
      'Shinsa chose this: Nothing it reads is changing.'
    );
  });
});

describe('the Account fact', () => {
  it('names the account a finished task ran on without offering to move it', () => {
    renderFacts(
      createTask({ id: 't', stage: 'merged', branch: 'feat/x', account: { id: 'a', email: 'a@example.com' } })
    );
    expect(screen.getByText('Runs on a@example.com')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Runs on a@example.com' })).toBeNull();
  });

  it('says which account a bound task runs on and rebinds it', async () => {
    renderFacts(createTask({ id: 't', account: { id: 'a', email: 'a@example.com' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Runs on a@example.com' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Any account', 'false'],
      ['a@example.com', 'true'],
      ['b@example.com', 'false'],
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'b@example.com' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'task.bind_account', taskId: 't', account: { id: 'b', email: 'b@example.com' } },
      ])
    );
  });

  it('is left out for a task that runs on any account', () => {
    renderFacts(createTask({ id: 't' }));
    expect(screen.queryByRole('button', { name: /^Runs on/ })).toBeNull();
  });
});

describe('the round and the agents in the facts row', () => {
  it('names the current round with one icon and, on hover, its title, how it stands and when it started', async () => {
    const task = createTask({
      id: 't',
      handle: 'SW-7',
      rounds: [
        createRound({ number: 1, status: 'finished' }),
        createRound({ number: 2, title: 'Explain what it can do', status: 'active', outcome: null }),
      ],
    });
    renderFacts(task);
    const round = screen.getByText('Round 2 of 2');
    expect(screen.getByRole('button', { name: 'Copy SW-7' }).textContent).toBe('SW-7');
    expect(await findTooltipText(round)).toMatch(/^Round 2: Explain what it can doIn progressStarted /);
  });

  it('lists who worked on the task, each role once and its delegated agents under it, opening the chat', async () => {
    const task = createTask({ id: 't', handle: 'SW-7' });
    const state = createShinsaState({
      tasks: [task],
      runs: [
        createRun({ id: 'a', taskId: 't', role: 'answerer', startedAt: 1, endedAt: 2, outcome: 'completed' }),
        createRun({ id: 'b', taskId: 't', role: 'answerer', startedAt: 3 }),
      ],
    });
    pushState(state);
    render(
      <TooltipProvider>
        <TaskFacts state={state} task={task} />
      </TooltipProvider>
    );
    const trigger = screen.getByRole('button', { name: /1 agent/ });
    await act(async () => {
      fireEvent.pointerEnter(trigger);
      fireEvent.mouseEnter(trigger);
      fireEvent.pointerMove(trigger);
      fireEvent.mouseMove(trigger);
    });
    const list = await screen.findByRole('list', { name: 'Who worked on this' });
    expect(list.textContent).toBe('Answerer2 runs · working now');
    fireEvent.click(screen.getByRole('button', { name: /Answerer/ }));
    expect(window.location.pathname + window.location.search).toBe('/tasks/SW-7?tab=chat&run=b');
  });
});
