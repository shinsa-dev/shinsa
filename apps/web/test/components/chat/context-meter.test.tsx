import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ShinsaState, Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { ChatTab } from '@/routes/task/chat.tsx';
import { findTooltipText } from '../../support/hover.ts';
import {
  createEntry,
  pushState,
  pushTranscript,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

function renderChat(state: ShinsaState, shown: Task) {
  pushState(state);
  return render(
    <TooltipProvider>
      <ChatTab state={state} task={shown} focusRunId={null} />
    </TooltipProvider>
  );
}

function context(usedTokens: number, id: string, at: number) {
  return createEntry(
    {
      type: 'notice',
      notice: { kind: 'context', usedTokens, maxTokens: 200_000, totalProcessedTokens: null },
    },
    id,
    at
  );
}

const task = createTask({ id: 'task-1' });

const build = createRun({
  id: 'run-1',
  purpose: 'build',
  taskId: 'task-1',
  startedAt: NOW - 60_000,
  endedAt: NOW - 30_000,
  outcome: 'completed',
});

const fix = createRun({ id: 'run-2', taskId: 'task-1', purpose: 'fix', startedAt: NOW - 20_000 });

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

describe('the context meter in the task chat', () => {
  it('shows how full the latest reporting run’s context is, with the token counts on hover', async () => {
    pushTranscript('run-1', [context(40_000, 'c1', NOW - 50_000), context(160_000, 'c2', NOW - 40_000)]);
    pushTranscript('run-2', [
      createEntry({ type: 'agent', phase: 'interim', text: 'Fixing.' }, 'a1', NOW - 10_000),
    ]);
    renderChat(createShinsaState({ tasks: [task], runs: [build, fix] }), task);
    const meter = screen.getByRole('img', { name: 'Context 80% full' });
    expect(meter.textContent).toBe('80%');
    expect(await findTooltipText(meter)).toBe('160k of 200k tokens · Context 80% full');
  });

  it('follows the newest run once it reports', () => {
    pushTranscript('run-1', [context(160_000, 'c2', NOW - 40_000)]);
    pushTranscript('run-2', [context(20_000, 'c3', NOW - 5_000)]);
    renderChat(createShinsaState({ tasks: [task], runs: [build, fix] }), task);
    expect(screen.getByRole('img', { name: 'Context 10% full' })).toBeTruthy();
  });

  it('shows nothing before any run reports its context', () => {
    pushTranscript('run-1', []);
    pushTranscript('run-2', []);
    renderChat(createShinsaState({ tasks: [task], runs: [build, fix] }), task);
    expect(screen.queryByRole('img', { name: /^Context/ })).toBeNull();
  });
});
