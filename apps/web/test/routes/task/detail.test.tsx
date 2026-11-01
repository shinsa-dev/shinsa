import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, cleanup, render } from '@testing-library/react';
import { connection, useConnection } from '@/lib/connection/socket.ts';
import { TaskPage } from '@/routes/task/index.tsx';
import { prefetchTask } from '@/routes/task/prefetch.tsx';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { answerTaskDetails, pushViewState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const STATE = createShinsaState({
  tasks: [
    createTask({ id: 'merged-1', handle: 'SW-1', title: 'Fix the login', stage: 'merged' }),
    createTask({ id: 'open-1', handle: 'SW-2', title: 'Tidy the inbox', stage: 'building' }),
  ],
  patch: { seq: 3 },
});

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

beforeEach(() => {
  fake = startFakeOnboarding({
    'GET /api/health': { answer: { ok: true, seq: 3, problems: [] } },
  });
  startFakeServer();
});

afterEach(() => {
  cleanup();
  stopFakeServer();
  fake?.stop();
  fake = null;
});

function Page({ taskId }: { taskId: string }) {
  const { state } = useConnection();
  if (!state) return null;
  return <TaskPage state={state as unknown as ShinsaState} taskId={taskId} />;
}

function renderPage(taskId: string) {
  return render(
    <TooltipProvider>
      <Page taskId={taskId} />
    </TooltipProvider>
  );
}

describe('a settled task the page holds as a summary', () => {
  it('waits on a loading line while it asks for the detail, then shows the task', () => {
    pushViewState(STATE);
    const view = renderPage('SW-1');
    expect(view.container.querySelector('[data-loading-pending="Reading the task"]')).not.toBeNull();
    expect(answerTaskDetails()).toEqual(['merged-1']);
    expect(view.container.querySelector('[data-loading-pending="Reading the task"]')).toBeNull();
    expect(connection.snapshot().state?.tasks['merged-1']?.summarized).toBeUndefined();
    expect(view.getAllByText('Fix the login').length).toBeGreaterThan(0);
  });

  it('asks for nothing for an open task, and asks for a settled one on hover', () => {
    pushViewState(STATE);
    renderPage('SW-2');
    expect(answerTaskDetails()).toEqual([]);
    act(() => prefetchTask(STATE, 'merged-1'));
    expect(answerTaskDetails()).toEqual(['merged-1']);
  });
});
