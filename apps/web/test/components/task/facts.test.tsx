import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { PipelineStep, Task, TriageDecisions } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskFacts } from '@/components/task/facts.tsx';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { findTooltipText } from '../../support/hover.ts';
import {
  listSentCommands,
  pushAccounts,
  pushState,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

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

  it('gives the kind its steps and Shinsa’s reason in its tooltip, and offers no way to change it', async () => {
    const view = renderFacts(decided());
    const kind = view.getByText('Answer only');
    expect(kind.closest('button')).toBeNull();
    expect(await findTooltipText(kind.parentElement as HTMLElement)).toBe(
      'Answer only: find the repository, then answer.Shinsa chose this: It asks how something works.'
    );
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
    const kind = view.getByText('Change');
    expect(kind.closest('button')).toBeNull();
    expect(await findTooltipText(kind.parentElement as HTMLElement)).toBe(
      'Change: plan, build, checks and agent review, your review, pull request, then merge.You changed this. Shinsa chose “answer only”: It asks how something works.'
    );
  });

  it('puts why a task waits on its Waits on fact, which starts it now', async () => {
    const base = createTask({ id: 'base', title: 'Fix the schema' });
    const task = decided({
      stage: 'queued',
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

describe('steps the planner composed, in the facts', () => {
  const COMPOSED: PipelineStep[] = ['investigate', 'your_ok', 'plan', 'operate'];

  it('name the kind by its steps and give the planner’s reason', async () => {
    const view = renderFacts(
      createTask({
        id: 't',
        stage: 'investigating',
        pipeline: COMPOSED,
        triageDecisions: { ...DECIDED, shape: { value: 'change', why: 'It asks for work.' } },
        shapeChanges: [
          {
            from: ['plan', 'operate'],
            to: COMPOSED,
            by: 'agent',
            reason: 'Find what is stuck first.',
            at: 1,
          },
        ],
      })
    );
    const kind = view.getByText('Investigation, then operation');
    expect(kind.closest('button')).toBeNull();
    expect(await findTooltipText(kind.parentElement as HTMLElement)).toBe(
      'Investigation, then operation: find the repository, investigate, your OK to run, plan, then run the operation.An agent set these steps: Find what is stuck first.'
    );
  });
});

describe('the kind of task in the facts', () => {
  it('names the kind of every task without a menu to change it', () => {
    const investigation = renderFacts(
      createTask({ id: 't', stage: 'investigating', pipeline: ['investigate'] })
    );
    expect(investigation.getByText('Investigation')).toBeTruthy();
    expect(investigation.queryByRole('button', { name: 'Investigation' })).toBeNull();
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
