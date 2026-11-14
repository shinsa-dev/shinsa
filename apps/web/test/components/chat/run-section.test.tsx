import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render } from '@testing-library/react';
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
        <RunSection run={run} task={task} messages={[]} waiting={false} />
      </TooltipProvider>
    );
    const worked = await view.findByText(/Worked for/);
    const reply = view.getByText(REPLY);
    const card = view.getByText('Finished the fix');
    expect(worked.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.queryByText('Checking the suggestions.')).toBeNull();
  });

  it('shows the answer written before a fix hand-over as the reply, outside the fold', async () => {
    const answer = 'This PR keeps sampling everywhere but one service.';
    pushState(createShinsaState({ tasks: [task], runs: [run] }));
    pushTranscript('run-fix', [
      createEntry(
        { type: 'tool_call', callId: 'r1', tool: { kind: 'read', path: 'collector-config.ts', range: null } },
        'r1',
        STARTED
      ),
      createEntry({ type: 'agent', phase: 'interim', text: answer }, 'a1', STARTED + 500),
      createEntry(
        {
          type: 'tool_call',
          callId: 'c1',
          tool: {
            kind: 'shinsa',
            name: 'complete_fix',
            args: { summary: 'No code change: explained the PR.' },
          },
        },
        'c1',
        STARTED + 1000
      ),
      createEntry({ type: 'agent', phase: 'final', text: 'No response requested.' }, 'a2', STARTED + 2000),
    ]);
    const view = render(
      <TooltipProvider>
        <RunSection run={run} task={task} messages={[]} waiting={false} />
      </TooltipProvider>
    );
    const worked = await view.findByText(/Worked for/);
    const reply = view.getByText(answer);
    const card = view.getByText('Finished the fix');
    expect(worked.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.queryByText('No response requested.')).toBeNull();
  });

  it('shows no header on the Agent’s own run, and one that wraps on a phone once the run failed', async () => {
    const failed = createRun({ ...run, outcome: 'failed' });
    pushState(createShinsaState({ tasks: [task], runs: [failed] }));
    pushTranscript('run-fix', [
      createEntry(
        { type: 'tool_call', callId: 'r1', tool: { kind: 'read', path: 'a.ts', range: null } },
        'r1',
        STARTED
      ),
      createEntry({ type: 'agent', phase: 'final', text: REPLY }, 'a2', STARTED + 2000),
    ]);
    const quiet = render(
      <TooltipProvider>
        <RunSection run={run} task={task} messages={[]} waiting={false} rerun />
      </TooltipProvider>
    );
    await quiet.findByText(/Worked for/);
    expect(quiet.queryByText('Agent')).toBeNull();
    quiet.unmount();
    const view = render(
      <TooltipProvider>
        <RunSection run={failed} task={task} messages={[]} waiting={false} />
      </TooltipProvider>
    );
    const worked = (await view.findByText(/Worked for/)).closest('[data-chat-line]');
    expect(view.getByText(/Failed/)).toBeTruthy();
    const header = view.getByText('Agent').closest('[data-chat-line]');
    expect(header?.className.split(' ')).toContain('max-sm:h-auto');
    expect(worked?.className.split(' ')).not.toContain('max-sm:h-auto');
  });

  it('folds what the run loaded and its folded turns into Worked for once the turn ended', async () => {
    pushState(createShinsaState({ tasks: [task], runs: [run] }));
    pushTranscript('run-fix', [
      createEntry(
        {
          type: 'notice',
          notice: {
            kind: 'extensions',
            servers: [{ name: 'linear', tokens: 4_200 }],
            skills: [],
            plugins: [],
          },
        },
        'x1',
        STARTED
      ),
      createEntry(
        { type: 'tool_call', callId: 'r1', tool: { kind: 'read', path: 'a.ts', range: null } },
        'r1',
        STARTED + 500
      ),
      createEntry(
        {
          type: 'notice',
          notice: { kind: 'compaction', trigger: 'fold', preTokens: null, summary: null, by: 'eunoe' },
        },
        'f1',
        STARTED + 1000
      ),
      createEntry({ type: 'agent', phase: 'final', text: REPLY }, 'a2', STARTED + 2000),
    ]);
    const view = render(
      <TooltipProvider>
        <RunSection run={run} task={task} messages={[]} waiting={false} />
      </TooltipProvider>
    );
    const worked = await view.findByRole('button', { name: /^Worked for/ });
    expect(view.getByText(REPLY)).toBeTruthy();
    expect(view.queryByRole('button', { name: /^Loaded 1 MCP/ })).toBeNull();
    fireEvent.click(worked);
    const loaded = view.getByRole('button', { name: /^Loaded 1 MCP/ });
    expect(worked.compareDocumentPosition(loaded) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      view.getAllByRole('button').some((row) => row.textContent?.startsWith('Finished turns folded'))
    ).toBe(true);
  });

  it('keeps what a live run loaded out of view, under its live card', async () => {
    const live = createRun({ id: 'run-live', taskId: 'task-1', startedAt: STARTED });
    pushState(createShinsaState({ tasks: [task], runs: [live] }));
    pushTranscript('run-live', [
      createEntry(
        {
          type: 'notice',
          notice: {
            kind: 'extensions',
            servers: [{ name: 'linear', tokens: 4_200 }],
            skills: [],
            plugins: [],
          },
        },
        'x1',
        STARTED
      ),
      createEntry(
        { type: 'tool_call', callId: 'r1', tool: { kind: 'read', path: 'a.ts', range: null } },
        'r1',
        STARTED + 500
      ),
    ]);
    const view = render(
      <TooltipProvider>
        <RunSection run={live} task={task} messages={[]} waiting={false} />
      </TooltipProvider>
    );
    expect((await view.findAllByText('Reading a.ts')).length).toBeGreaterThan(0);
    expect(view.queryByRole('button', { name: /^Loaded 1 MCP/ })).toBeNull();
    expect(view.queryByRole('button', { name: /^Worked for/ })).toBeNull();
  });

  it('shows a reviewer’s run as another sender, with no toggle, and leaves the Agent’s without a header', async () => {
    const review = createRun({
      id: 'run-review',
      taskId: 'task-1',
      role: 'reviewer',
      startedAt: STARTED,
      endedAt: NOW,
      outcome: 'completed',
    });
    pushState(createShinsaState({ tasks: [task], runs: [run, review] }));
    pushTranscript('run-review', [
      createEntry({ type: 'agent', phase: 'final', text: 'No findings.' }, 'r1', STARTED + 1000),
    ]);
    pushTranscript('run-fix', [createEntry({ type: 'agent', phase: 'final', text: REPLY }, 'a1', STARTED)]);
    const view = render(
      <TooltipProvider>
        <RunSection run={review} task={task} messages={[]} waiting={false} />
        <RunSection run={run} task={task} messages={[]} waiting={false} />
      </TooltipProvider>
    );
    const verdict = await view.findByText('No findings.');
    expect(verdict.closest('[data-speaker]')?.getAttribute('data-speaker')).toBe('reviewer');
    expect(view.getByText('Reviewer').closest('[data-speaker-header]')).not.toBeNull();
    expect((await view.findByText(REPLY)).closest('[data-speaker]')).toBeNull();
    expect(view.container.querySelectorAll('[data-speaker]')).toHaveLength(1);
    expect(view.queryByText('Agent')).toBeNull();
    expect(view.queryByRole('button', { name: /^Reviewer/ })).toBeNull();
  });
});
