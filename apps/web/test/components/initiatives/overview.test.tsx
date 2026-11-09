import { describe, expect, it } from 'bun:test';
import { resolveInitiativeSheet, type ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { HomeInitiatives } from '@/components/home/initiatives.tsx';
import { InitiativeOverview } from '@/components/initiatives/sheet.tsx';
import { createGate, createInitiative, createShinsaState, createTask, NOW } from '../../support/state.ts';

const LEAD = createTask({
  id: 'lead',
  handle: 'SW-130',
  title: 'Chat split',
  pipeline: ['lead'],
  stage: 'leading',
  initiativeId: 'split',
});

function createSplitState(report: { narrative: string; questions: string[] } | null) {
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
  const sheet = resolveInitiativeSheet(state, 'split', NOW);
  if (!sheet) throw new Error('no sheet');
  render(
    <TooltipProvider>
      <InitiativeOverview state={state} sheet={sheet} />
    </TooltipProvider>
  );
}

describe('the lead task’s overview', () => {
  it('shows where it stands, its questions, its phases and its tasks grouped by phase', () => {
    renderOverview(createSplitState({ narrative: 'The dock is in review.', questions: ['Merge it first?'] }));
    expect(screen.getByRole('heading', { name: /Where it stands/ })).toBeTruthy();
    expect(screen.getByText('The dock is in review.')).toBeTruthy();
    expect(screen.getByText('Merge it first?')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Phases' }).textContent).toContain('Dock host');
    expect(screen.getByText('Rewrite the agent dock')).toBeTruthy();
    expect(screen.getByText('Add the studio chat')).toBeTruthy();
    expect(screen.getAllByText('Studio chat')).toHaveLength(2);
    expect(screen.getAllByText('No phase').length).toBeGreaterThan(0);
  });

  it('says the lead has not reported before its first report', () => {
    renderOverview(createSplitState(null));
    expect(screen.getByText(/The lead hasn’t reported yet/)).toBeTruthy();
  });
});

describe('Home’s initiatives', () => {
  it('lists each open initiative with how far it is, and opens its lead task', () => {
    history.replaceState(null, '', '/');
    render(
      <TooltipProvider>
        <HomeInitiatives state={createSplitState({ narrative: 'Going.', questions: [] })} />
      </TooltipProvider>
    );
    expect(screen.getByText('3 tasks · 3 open · 0 shipped')).toBeTruthy();
    fireEvent.click(screen.getByText('Chat split'));
    expect(location.pathname).toBe('/tasks/SW-130');
  });

  it('shows nothing without an open initiative', () => {
    const { container } = render(<HomeInitiatives state={createSplitState(null)} />);
    expect(container.textContent).not.toBe('');
    const none = render(<HomeInitiatives state={createShinsaState({})} />);
    expect(none.container.textContent).toBe('');
  });
});
