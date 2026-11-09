import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen, waitFor } from '@testing-library/react';
import { InitiativePage, InitiativesPage } from '@/routes/initiatives.tsx';
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
