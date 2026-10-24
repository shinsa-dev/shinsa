import { describe, expect, it } from 'bun:test';
import { resolveFallbackBriefing, resolveQueue } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { HomeGuide } from '@/components/home/guide.tsx';
import { createRepo, createShinsaState, createTask } from '../../support/state.ts';

function renderGuide(stage: 'building' | 'merged') {
  const state = createShinsaState({
    repos: [createRepo({ id: 'api' })],
    tasks: [createTask({ id: 'build', title: 'Build the export', repoId: 'api', stage })],
  });
  const queue = resolveQueue(state, state.seq);
  return render(
    <TooltipProvider>
      <HomeGuide state={state} queue={queue} briefing={resolveFallbackBriefing(queue, state.seq)} />
    </TooltipProvider>
  );
}

describe('HomeGuide', () => {
  it('names what agents are doing', () => {
    renderGuide('building');
    expect(screen.getByText(/An agent is/)).toBeTruthy();
  });

  it('leaves the running line out when nothing runs, since In progress below already says so', () => {
    renderGuide('merged');
    expect(screen.queryByText(/An agent is|Agents are/)).toBeNull();
    expect(screen.getByText('Nothing needs you right now.')).toBeTruthy();
  });
});
