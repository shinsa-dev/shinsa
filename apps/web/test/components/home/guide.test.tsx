import { describe, expect, it, setSystemTime } from 'bun:test';
import { createSettings, resolveFallbackBriefing, resolveQueue, type Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { HomeGuide } from '@/components/home/guide.tsx';
import { createNights } from '../../support/away.ts';
import { createGate, createRepo, createShinsaState, createTask, NOW } from '../../support/state.ts';

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

  it('names the builds waiting for Auto pace apart from the running ones, and the reviews built overnight', () => {
    setSystemTime(new Date(NOW));
    const now = NOW;
    const night = Math.floor(now / 86_400_000) * 86_400_000 + 3 * 3_600_000;
    const wait = (id: string, resetAt: number) =>
      ({
        id,
        runId: id,
        status: 'armed',
        cause: 'pace',
        pace: { scope: 'admission' },
        resetAt,
      }) as Task['usageWait'];
    const waiting = ['one', 'two', 'three'].map((id, index) =>
      createTask({
        id,
        title: `Waiting ${id}`,
        repoId: 'api',
        stage: 'building',
        usageWait: wait(id, now + (index + 1) * 60_000),
      })
    );
    const state = createShinsaState({
      repos: [createRepo({ id: 'api' })],
      tasks: [
        createTask({ id: 'build', title: 'Build the export', repoId: 'api', stage: 'building' }),
        createTask({ id: 'done', title: 'Built at night', repoId: 'api', stage: 'awaiting_review' }),
        ...waiting,
      ],
      gates: [createGate({ id: 'g', taskId: 'done', type: 'review', status: 'open', openedAt: night })],
      patch: { settings: { ...createSettings(), autoPace: true }, away: createNights() },
    });
    const queue = resolveQueue(state, state.seq);
    render(
      <TooltipProvider>
        <HomeGuide state={state} queue={queue} briefing={resolveFallbackBriefing(queue, state.seq)} />
      </TooltipProvider>
    );
    expect(screen.getByText(/An agent is/)).toBeTruthy();
    const waitingLine = screen.getByText(/^Waiting to build within today’s usage:/).textContent;
    expect(waitingLine).toMatch(/Waiting one after .+, Waiting two after .+ and 1 more\.$/);
    expect(waitingLine).not.toContain('Waiting three');
    expect(screen.getByText(/^An agent is/).textContent).not.toContain('Waiting');
    expect(screen.getByText('1 task built overnight is ready for your review.')).toBeTruthy();
    setSystemTime();
  });
});
