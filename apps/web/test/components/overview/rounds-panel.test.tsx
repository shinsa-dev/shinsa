import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RoundsPanel } from '@/components/overview/rounds-panel.tsx';
import { TaskHandle, TaskHandlePrefix } from '@/components/task/handle.tsx';
import { createRound } from '../../support/rounds.ts';
import { startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createRun, createShinsaState, createTask } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

const OPEN = {
  number: 12,
  url: 'https://github.com/o/r/pull/12',
  state: 'open' as const,
  checks: 'passing' as const,
  unresolvedComments: 0,
  mergeable: true,
  updatedAt: 0,
};

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

describe('the rounds of a task on its Overview', () => {
  it('keeps earlier rounds folded and readable, and lets you choose how a waiting round ships', async () => {
    const changed = mock(() => Promise.resolve(true));
    const task = createTask({
      id: 't',
      handle: 'SW-14',
      pullRequest: OPEN,
      rounds: [
        createRound({
          number: 1,
          title: 'Add MCP v2',
          outcome: {
            goal: 'Add MCP v2.',
            phases: ['Wire it'],
            headline: 'Added MCP v2.',
            result: 'It works.',
          },
        }),
        createRound({ number: 2, status: 'active', outcome: null }),
        createRound({
          number: 3,
          title: 'Cache it',
          status: 'waiting',
          startedAt: null,
          pullRequest: null,
          outcome: null,
        }),
      ],
    });
    const opened = mock((_runId: string) => undefined);
    const state = createShinsaState({
      tasks: [task],
      runs: [
        createRun({ id: 'r1', taskId: 't', purpose: 'plan', startedAt: 1 }),
        createRun({ id: 'r2', taskId: 't', purpose: 'plan', startedAt: 2, round: 2 }),
      ],
    });
    render(
      <TooltipProvider>
        <RoundsPanel state={state} task={task} onOpen={opened} onShippingChange={changed} />
      </TooltipProvider>
    );
    const earlier = screen.getByRole('list', { name: 'Earlier rounds' });
    expect(within(earlier).getByText('Add MCP v2')).toBeTruthy();
    expect(within(earlier).queryByText('Do round 1')).toBeNull();
    fireEvent.click(within(earlier).getByRole('button', { name: /round 1/ }));
    expect(within(earlier).getByText('Add MCP v2. It works. Merged in pull request #12.')).toBeTruthy();
    expect(within(earlier).queryByText('Do round 1')).toBeNull();
    expect(within(earlier).queryByRole('list', { name: 'Progress' })).toBeNull();
    fireEvent.click(within(earlier).getByRole('button', { name: 'Open in chat' }));
    expect(opened.mock.calls).toEqual([['r1']]);
    const waiting = screen.getByRole('list', { name: 'Rounds waiting to start' });
    fireEvent.click(within(waiting).getByRole('button', { name: /round 3/ }));
    expect(within(waiting).getByText('Cache it. It starts once round 2 is finished.')).toBeTruthy();
    expect(within(waiting).queryByRole('button', { name: 'Open in chat' })).toBeNull();
    fireEvent.click(within(waiting).getByRole('combobox', { name: 'How round 3 ships' }));
    const list = (await screen.findAllByRole('listbox')).at(-1) as HTMLElement;
    const option = within(list).getByRole('option', { name: 'As a stacked pull request' });
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.click(option);
    await waitFor(() =>
      expect(changed.mock.calls[0]).toEqual([expect.objectContaining({ number: 3 }), 'stacked'] as never)
    );
    await waitForGone(() => screen.queryByRole('listbox'));
  });

  it('opens an earlier round that left post-merge steps and lists them to tick', () => {
    const task = createTask({
      id: 't',
      rounds: [
        createRound({ number: 1, title: 'Fix the revenue' }),
        createRound({ number: 2, title: 'Check purchases', status: 'active', outcome: null }),
      ],
      carriedMergeSteps: [
        {
          when: 'post_merge',
          kind: 'deploy',
          title: 'Deploy the API',
          detail: 'By hand.',
          command: null,
          round: 1,
          done: false,
        },
      ],
    });
    const view = render(
      <TooltipProvider>
        <RoundsPanel state={createShinsaState({ tasks: [task] })} task={task} onOpen={() => undefined} />
      </TooltipProvider>
    );
    expect(view.getByText('Post-merge steps')).toBeTruthy();
    expect(view.getByRole('checkbox', { name: 'Deploy the API' })).toBeTruthy();
  });

  it('shows nothing for a task with one round', () => {
    const task = createTask({ id: 't' });
    const view = render(
      <RoundsPanel state={createShinsaState({ tasks: [task] })} task={task} onOpen={() => undefined} />
    );
    expect(view.container.textContent).toBe('');
  });

  it('names the current round after the handle', () => {
    const task = createTask({
      id: 't',
      handle: 'SW-14',
      rounds: [createRound({ number: 1 }), createRound({ number: 2, status: 'active' })],
    });
    const view = render(
      <>
        <TaskHandle task={task} />
        <TaskHandlePrefix task={task} />
        <TaskHandle task={createTask({ id: 'x' })} />
        <TaskHandlePrefix task={createTask({ id: 'x' })} />
        <TaskHandlePrefix task={task} round={false} />
      </>
    );
    expect(view.container.textContent).toBe('SW-14 · Round 2SW-14 · Round 2 · SW-14 · ');
  });
});
