import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RoundsPanel } from '@/components/overview/rounds-panel.tsx';
import { TaskHandle, TaskHandlePrefix } from '@/components/task/handle.tsx';
import { createRound } from '../../support/rounds.ts';
import { startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createTask } from '../../support/state.ts';

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
          status: 'queued',
          startedAt: null,
          pullRequest: null,
          outcome: null,
        }),
      ],
    });
    render(
      <TooltipProvider>
        <RoundsPanel task={task} onShippingChange={changed} />
      </TooltipProvider>
    );
    const earlier = screen.getByRole('list', { name: 'Earlier rounds' });
    expect(within(earlier).getByText('Add MCP v2')).toBeTruthy();
    expect(within(earlier).queryByText('Asked for')).toBeNull();
    fireEvent.click(within(earlier).getByRole('button', { name: /Round 1/ }));
    expect(within(earlier).getByText('Asked for')).toBeTruthy();
    expect(within(earlier).getByText('Added MCP v2.')).toBeTruthy();
    expect(within(earlier).getByText('It works.')).toBeTruthy();
    const waiting = screen.getByRole('list', { name: 'Rounds waiting to start' });
    fireEvent.click(within(waiting).getByRole('combobox', { name: 'How round 3 ships' }));
    const list = (await screen.findAllByRole('listbox')).at(-1) as HTMLElement;
    const option = within(list).getByRole('option', { name: 'As a stacked pull request' });
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.click(option);
    await waitFor(() =>
      expect(changed.mock.calls[0]).toEqual([expect.objectContaining({ number: 3 }), 'stacked'] as never)
    );
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('shows nothing for a task with one round', () => {
    const view = render(<RoundsPanel task={createTask({ id: 't' })} />);
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
      </>
    );
    expect(view.container.textContent).toBe('SW-14 · round 2SW-14 · round 2 · ');
  });
});
