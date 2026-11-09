import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InitiativePage, InitiativesPage } from '@/routes/initiatives.tsx';
import { spyOnCommands } from '../support/commands.ts';
import { spyOnEngine } from '../support/engine.ts';
import { createGate, createInitiative, createShinsaState, createTask, NOW } from '../support/state.ts';

const state = createShinsaState({
  initiatives: [
    createInitiative({
      id: 'split',
      name: 'Chat split',
      description: 'Restart the chat stack as small pull requests.',
      phases: [
        { id: 'p1', name: 'Dock host' },
        { id: 'p2', name: 'Studio chat' },
      ],
    }),
  ],
  tasks: [
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
    createTask({
      id: 'dropped',
      title: 'Port the GitHub connection',
      stage: 'cancelled',
      stageReason: 'cancelled by you',
      closedAt: NOW,
      initiativeId: 'split',
      initiativePhaseId: 'p2',
    }),
  ],
  gates: [createGate({ id: 'g', taskId: 'review', type: 'review' })],
});

describe('the initiatives list', () => {
  it('lists each initiative with how far it is', () => {
    render(
      <TooltipProvider>
        <InitiativesPage state={state} />
      </TooltipProvider>
    );
    expect(screen.getByRole('heading', { name: 'Initiatives' })).toBeTruthy();
    expect(screen.getByText('Chat split')).toBeTruthy();
    expect(screen.getByText('3 tasks · 2 open · 0 shipped')).toBeTruthy();
  });

  it('says how to start when there are none', () => {
    render(<InitiativesPage state={createShinsaState({})} />);
    expect(screen.getByText('No initiatives yet')).toBeTruthy();
  });
});

describe('an initiative’s page', () => {
  it('shows its phases and what needs you, what comes next and what was dropped', () => {
    render(
      <TooltipProvider>
        <InitiativePage state={state} reference='split' />
      </TooltipProvider>
    );
    expect(screen.getByRole('heading', { name: 'Chat split' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Phases' }).textContent).toContain('Dock host');
    expect(screen.getByText('Rewrite the agent dock')).toBeTruthy();
    expect(screen.getByText('Add the studio chat')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Dropped/ })).toBeTruthy();
  });

  it('replaces a name in the address with the initiative’s id', async () => {
    history.replaceState(null, '', '/initiatives/Chat%20split');
    render(
      <TooltipProvider>
        <InitiativePage state={state} reference='Chat split' />
      </TooltipProvider>
    );
    await waitFor(() => expect(location.pathname).toBe('/initiatives/split'));
  });

  it('says when there is no such initiative', () => {
    render(<InitiativePage state={state} reference='nothing' />);
    expect(screen.getByText('No such initiative')).toBeTruthy();
  });
});

function renderPage(shown = state) {
  return render(
    <TooltipProvider>
      <InitiativePage state={shown} reference='split' />
    </TooltipProvider>
  );
}

function withLead(report: { narrative: string; questions: string[] } | null) {
  const initiative = state.initiatives.split;
  if (!initiative) throw new Error('no initiative');
  return createShinsaState({
    initiatives: [
      {
        ...initiative,
        leadTaskId: 'lead',
        report: report ? { ...report, runId: 'r', at: NOW - 60_000 } : null,
      },
    ],
    tasks: [
      ...Object.values(state.tasks),
      createTask({
        id: 'lead',
        handle: 'SW-130',
        title: 'Lead the chat split',
        pipeline: ['lead'],
        stage: 'leading',
        initiativeId: 'split',
      }),
    ],
    gates: Object.values(state.gates),
  });
}

describe('an initiative’s lead', () => {
  it('offers to start one, fresh or from a member’s chat', async () => {
    spyOnEngine();
    const spies = spyOnCommands();
    renderPage();
    expect(screen.getByText('No lead yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start a lead' }));
    expect(await screen.findByRole('dialog', { name: 'Start a lead' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start lead' }));
    await waitFor(() =>
      expect(spies.sent.mock.calls.map((call) => call[0])).toEqual([
        { type: 'initiative.start_lead', initiativeId: 'split', forkOf: null },
      ])
    );
  });

  it('hides the start button on an engine without leads', () => {
    spyOnEngine(null);
    renderPage();
    expect(screen.getByText('No lead yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start a lead' })).toBeNull();
  });

  it('says the lead has not reported yet before its first turn', () => {
    renderPage(withLead(null));
    const lead = screen.getByRole('region', { name: 'From the lead' });
    expect(lead.textContent).toContain('The lead hasn’t reported yet.');
    expect(lead.textContent).toContain('Lead the chat split');
  });

  it('shows the lead’s narrative and open questions above the sections, and opens its chat', async () => {
    renderPage(withLead({ narrative: 'The dock is in **review**.', questions: ['Ship the studio first?'] }));
    const lead = screen.getByRole('region', { name: 'From the lead' });
    expect(lead.textContent).toContain('The dock is in review.');
    expect(lead.textContent).toContain('Anything to discuss');
    expect(lead.textContent).toContain('Ship the studio first?');
    expect(screen.queryByText('No lead yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the chat' }));
    await waitFor(() => expect(location.pathname).toBe('/tasks/SW-130'));
  });
});
