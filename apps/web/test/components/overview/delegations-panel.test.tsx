import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Run, RunDelegation } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { DelegationsPanel } from '@/components/overview/delegations-panel.tsx';
import { createRound } from '../../support/rounds.ts';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

function delegated(id: string, overrides: Partial<Run>, patch: Partial<RunDelegation> = {}) {
  return createRun({
    id,
    taskId: 't',
    role: 'reviewer',
    status: 'running',
    startedAt: NOW - 30_000,
    delegation: {
      parentRunId: 'step',
      depth: 1,
      requestKey: id,
      title: `Delegated ${id}`,
      brief: 'Do it.',
      mode: 'async',
      wake: 'always',
      isolation: 'shared',
      baseCommit: null,
      delivery: 'none',
      question: null,
      requestedAt: NOW,
      ...patch,
    },
    ...overrides,
  });
}

function show(runs: Run[], task = createTask({ id: 't' })) {
  const state = createShinsaState({
    tasks: [task],
    runs: [createRun({ id: 'step', taskId: 't', status: 'running' }), ...runs],
  });
  pushState(state);
  const onOpen = mock((_runId: string) => undefined);
  const view = render(
    <TooltipProvider>
      <DelegationsPanel state={state} task={task} onOpen={onOpen} />
    </TooltipProvider>
  );
  return { onOpen, view };
}

describe('the delegated work panel on the Overview', () => {
  it('lists each delegated task under the one that delegated it, with how many still work', () => {
    const { onOpen } = show([
      delegated('a', {}),
      delegated('a1', { startedAt: NOW - 20_000 }, { parentRunId: 'a', depth: 2 }),
      delegated('b', { endedAt: NOW - 1_000, outcome: 'completed', summary: 'Done.' }),
    ]);
    expect(screen.getByText('Delegated work')).toBeTruthy();
    expect(screen.getByText('2 working · 1 done')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent?.split('·')[0])).toEqual([
      'ReviewerDelegated aWorking ',
      'ReviewerDelegated a1Working ',
      'ReviewerDelegated bFinished ',
    ]);
    expect(screen.getAllByRole('button', { name: /^Stop/ })).toHaveLength(2);
    fireEvent.click(screen.getByText('Delegated a1'));
    expect(onOpen).toHaveBeenCalledWith('a1');
  });

  it('lists only the delegated work of the current round', () => {
    const task = createTask({
      id: 't',
      stage: 'building',
      rounds: [
        createRound({ number: 1, status: 'merged' }),
        createRound({ number: 2, status: 'active', outcome: null }),
      ],
    });
    show(
      [
        createRun({ id: 'step-2', taskId: 't', round: 2, status: 'running' }),
        delegated('old', { endedAt: NOW - 1_000, outcome: 'completed' }),
        delegated('new', { round: 2 }, { parentRunId: 'step-2' }),
      ],
      task
    );
    expect(screen.queryByText('Delegated old')).toBeNull();
    expect(screen.getByText('Delegated new')).toBeTruthy();
    expect(screen.getByText('1 working')).toBeTruthy();
  });

  it('is left out when nothing was delegated', () => {
    const { view } = show([]);
    expect(view.container.textContent).toBe('');
  });
});
