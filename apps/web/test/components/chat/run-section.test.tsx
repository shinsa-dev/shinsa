import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render } from '@testing-library/react';
import { RunSection } from '@/components/chat/run-section.tsx';
import {
  createEntry,
  pushState,
  pushTranscript,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

const STARTED = NOW - 240_000;

const task = createTask({ id: 'task-1' });

const run = createRun({
  id: 'run-fix',
  taskId: 'task-1',
  startedAt: STARTED,
  endedAt: NOW,
  outcome: 'completed',
});

const REPLY = 'You couldn’t see it because I never accepted it, so I filed it as its own task.';

beforeEach(() => {
  startFakeServer();
  setSystemTime(new Date(NOW));
});

afterEach(() => {
  stopFakeServer();
  setSystemTime();
});

describe('RunSection', () => {
  it('shows the final reply directly under the worked-for line, above the hand-over card', async () => {
    pushState(createShinsaState({ tasks: [task], runs: [run] }));
    pushTranscript('run-fix', [
      createEntry({ type: 'agent', phase: 'interim', text: 'Checking the suggestions.' }, 'a1', STARTED),
      createEntry(
        {
          type: 'tool_call',
          callId: 'c1',
          tool: { kind: 'shinsa', name: 'complete_fix', args: { summary: 'Filed it as its own task.' } },
        },
        'c1',
        STARTED + 1000
      ),
      createEntry({ type: 'agent', phase: 'final', text: REPLY }, 'a2', STARTED + 2000),
    ]);
    const view = render(
      <TooltipProvider>
        <RunSection run={run} task={task} messages={[]} first waiting={false} />
      </TooltipProvider>
    );
    const worked = await view.findByText(/Worked for/);
    const reply = view.getByText(REPLY);
    const card = view.getByText('Handed over the fix');
    expect(worked.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.queryByText('Checking the suggestions.')).toBeNull();
  });
});
