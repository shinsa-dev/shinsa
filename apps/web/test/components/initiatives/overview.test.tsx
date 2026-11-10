import { describe, expect, it } from 'bun:test';
import { resolveInitiativeSheet, resolveQueue, type ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { Option } from 'effect';
import { InitiativeOverview } from '@/components/initiatives/sheet.tsx';
import { TaskQueue } from '@/components/queue/queue.tsx';
import { listQueueSections } from '@/lib/queue.ts';
import { createGate, createInitiative, createShinsaState, createTask, NOW } from '../../support/state.ts';

const LEAD = createTask({
  id: 'lead',
  handle: 'SW-130',
  title: 'Chat split',
  pipeline: ['lead'],
  stage: 'leading',
  initiativeId: 'split',
});

function createSplitState(report: { narrative: string } | null) {
  return createShinsaState({
    initiatives: [
      createInitiative({
        id: 'split',
        name: 'Chat split',
        leadTaskId: 'lead',
        phases: [
          { id: 'p1', name: 'Dock host' },
          { id: 'p2', name: 'Studio chat' },
        ],
        report: report ? { ...report, runId: 'r', at: NOW - 60_000 } : null,
      }),
    ],
    tasks: [
      LEAD,
      createTask({
        id: 'review',
        title: 'Rewrite the agent dock',
        stage: 'awaiting_review',
        initiativeId: 'split',
        initiativePhaseId: 'p1',
      }),
      createTask({
        id: 'later',
        title: 'Add the studio chat',
        stage: 'waiting_on_tasks',
        initiativeId: 'split',
        initiativePhaseId: 'p2',
      }),
      createTask({ id: 'loose', title: 'Tidy the docs', stage: 'waiting_on_tasks', initiativeId: 'split' }),
    ],
    gates: [createGate({ id: 'g', taskId: 'review', type: 'review' })],
  });
}

function renderOverview(state: ShinsaState) {
  const sheet = Option.getOrNull(resolveInitiativeSheet(state, 'split', NOW));
  if (!sheet) throw new Error('no sheet');
  render(
    <TooltipProvider>
      <InitiativeOverview state={state} sheet={sheet} />
    </TooltipProvider>
  );
}

describe('the lead task’s overview', () => {
  it('shows where it stands and the tasks grouped as All tasks does, by phase', () => {
    renderOverview(createSplitState({ narrative: 'The dock is in review.' }));
    expect(screen.getByRole('heading', { name: /Where it stands/ })).toBeTruthy();
    expect(screen.getByText('The dock is in review.')).toBeTruthy();
    expect(screen.getByText('Rewrite the agent dock')).toBeTruthy();
    expect(screen.getAllByText('Changes to review').length).toBeGreaterThan(0);
    expect(screen.getByText('Studio chat')).toBeTruthy();
    expect(screen.getByText('No phase')).toBeTruthy();
  });

  it('leaves where it stands out before the lead’s first report', () => {
    renderOverview(createSplitState(null));
    expect(screen.queryByRole('heading', { name: /Where it stands/ })).toBeNull();
    expect(screen.getByText('Rewrite the agent dock')).toBeTruthy();
  });
});

describe('Home with an initiative', () => {
  it('lists its member tasks and never its lead', () => {
    const state = createSplitState({ narrative: 'Going.' });
    render(
      <TooltipProvider>
        <TaskQueue
          state={state}
          variant='wide'
          sections={listQueueSections(state, resolveQueue(state, NOW))}
        />
      </TooltipProvider>
    );
    expect(screen.getByText('Rewrite the agent dock')).toBeTruthy();
    expect(screen.queryByText('Chat split')).toBeNull();
  });
});
