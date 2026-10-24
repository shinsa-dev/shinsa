import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Run, RunDelegation, ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatTab } from '@/routes/task/chat.tsx';
import { createCallEntry, createResultEntry, shinsaTool } from '../../support/chat.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { findTooltipText } from '../../support/hover.ts';
import {
  createEntry,
  pushState,
  pushTranscript,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createEvidence, createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

function delegation(overrides: Partial<RunDelegation> = {}): RunDelegation {
  return {
    parentRunId: 'step',
    depth: 1,
    requestKey: 'k',
    title: 'Survey the login tests',
    brief: 'Survey them.',
    mode: 'async',
    wake: 'always',
    isolation: 'shared',
    baseCommit: null,
    delivery: 'none',
    question: null,
    requestedAt: NOW,
    ...overrides,
  };
}

function renderChat(
  child: Partial<Run>,
  patch: Partial<RunDelegation> = {},
  focusRunId: string | null = null,
  extra: { runs?: Run[]; evidence?: Parameters<typeof createShinsaState>[0]['evidence'] } = {}
) {
  const task = createTask({ id: 't' });
  const step = createRun({ id: 'step', taskId: 't', status: 'running', startedAt: NOW - 60_000 });
  const run = createRun({
    id: 'child',
    taskId: 't',
    role: 'reviewer',
    status: 'running',
    startedAt: NOW - 30_000,
    delegation: delegation(patch),
    ...child,
  });
  const state = createShinsaState({
    tasks: [task],
    runs: [step, run, ...(extra.runs ?? [])],
    evidence: extra.evidence ?? [],
  });
  pushState(state);
  render(
    <TooltipProvider>
      <ChatTab state={state} task={task} focusRunId={focusRunId} />
    </TooltipProvider>
  );
  return state;
}

function spawn(at = NOW - 30_000) {
  return createEntry(
    { type: 'notice', notice: { kind: 'delegation', event: 'started', runIds: ['child'] } },
    'spawn',
    at
  );
}

describe('delegated work in the task’s chat', () => {
  it('shows a spawn card with the role, the title and a live status, and not a section of its own', () => {
    renderChat({});
    pushTranscript('step', [spawn()]);
    expect(screen.getByText('Survey the login tests')).toBeTruthy();
    expect(screen.getByText('Reviewer')).toBeTruthy();
    expect(screen.getByText('Working')).toBeTruthy();
    expect(document.querySelectorAll('section[id^="run-"]')).toHaveLength(1);
  });

  it('stops it, and what it delegated, from the card', async () => {
    const commands = spyOnCommands();
    renderChat({});
    pushTranscript('step', [spawn()]);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Stop “Survey the login tests” and what it delegated' })
      );
    });
    expect(commands.sent).toHaveBeenCalledWith({ type: 'delegation.cancel', runId: 'child' }, 'Stopped.');
    commands.restore();
  });

  it('names Stop the same in its tooltip as for a screen reader', async () => {
    renderChat({});
    pushTranscript('step', [spawn()]);
    const stop = screen.getByRole('button', { name: /^Stop “Survey the login tests”/ });
    expect(await findTooltipText(stop)).toBe(stop.getAttribute('aria-label') as string);
  });

  it('shows a question the delegated agent asked of the agent that delegated it', () => {
    renderChat(
      {},
      {
        question: {
          id: 'q',
          question: 'Which login form?',
          context: null,
          choices: [],
          recommendation: null,
          askedAt: NOW,
          delivered: true,
          answer: null,
          answeredAt: null,
        },
      }
    );
    pushTranscript('step', [spawn()]);
    expect(screen.getByText('Waiting for the agent that delegated it to answer')).toBeTruthy();
    expect(screen.getByText('Which login form?')).toBeTruthy();
  });

  it('opens the delegated agent’s own conversation inside the card', () => {
    renderChat({});
    pushTranscript('step', [spawn()]);
    pushTranscript('child', [
      createEntry(
        { type: 'agent', phase: 'final', text: 'Two of the tests are skipped.' },
        'c1',
        NOW - 10_000
      ),
    ]);
    fireEvent.click(screen.getByText('Survey the login tests'));
    expect(screen.getByText('Two of the tests are skipped.')).toBeTruthy();
  });

  it('marks the report coming back, with the result to open, and no stop once it ended', () => {
    renderChat({ endedAt: NOW - 5_000, outcome: 'completed', summary: 'Two of the tests are skipped.' });
    pushTranscript('step', [
      spawn(),
      createEntry(
        { type: 'notice', notice: { kind: 'delegation', event: 'reported', runIds: ['child', 'missing'] } },
        'report',
        NOW - 4_000
      ),
    ]);
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Stop “Survey the login tests”/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Reported back: Survey the login tests/ }));
    expect(screen.getByText('Two of the tests are skipped.')).toBeTruthy();
  });

  it('words a failed or stopped report by how it ended', () => {
    renderChat({ endedAt: NOW - 5_000, outcome: 'failed', summary: null });
    pushTranscript('step', [
      createEntry(
        { type: 'notice', notice: { kind: 'delegation', event: 'reported', runIds: ['child'] } },
        'report',
        NOW - 4_000
      ),
    ]);
    expect(screen.getByText('Failed: Survey the login tests')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Failed:/ })).toBeNull();
  });

  it('shows nothing for a delegated run that no longer exists', () => {
    const state: ShinsaState = renderChat({});
    expect(state.runs.child).toBeTruthy();
    pushTranscript('step', [
      createEntry(
        { type: 'notice', notice: { kind: 'delegation', event: 'started', runIds: ['gone'] } },
        'g',
        NOW
      ),
    ]);
    expect(screen.queryByText('Working')).toBeNull();
  });

  it('shows a delegated agent’s evidence in its own conversation', () => {
    const evidence = [
      createEvidence({
        id: 'e1',
        taskId: 't',
        runId: 'child',
        title: 'Login page',
        uri: '/api/evidence/e1.png',
      }),
    ];
    renderChat({ endedAt: NOW - 10_000, outcome: 'completed' }, {}, null, { evidence });
    pushTranscript('step', [spawn()]);
    pushTranscript('child', [
      createCallEntry('c1', shinsaTool('attach_evidence', { title: 'Login page' }), NOW - 20_000, 'a'),
      createResultEntry('c1', 'Attached.', NOW - 19_000),
    ]);
    fireEvent.click(screen.getByText('Survey the login tests'));
    fireEvent.click(screen.getByRole('button', { name: /^Worked for/ }));
    expect(Array.from(document.querySelectorAll('img')).map((img) => img.getAttribute('src'))).toContain(
      '/api/evidence/e1.png'
    );
  });

  it('opens a delegated task picked on the Overview: its card and every card above it', async () => {
    const grandchild = createRun({
      id: 'grandchild',
      taskId: 't',
      role: 'builder',
      status: 'running',
      startedAt: NOW - 20_000,
      delegation: delegation({ parentRunId: 'child', depth: 2, title: 'Shoot the page' }),
    });
    renderChat({}, {}, 'grandchild', { runs: [grandchild] });
    pushTranscript('step', [spawn()]);
    pushTranscript('child', [
      createEntry(
        { type: 'notice', notice: { kind: 'delegation', event: 'started', runIds: ['grandchild'] } },
        'spawn-2',
        NOW - 20_000
      ),
    ]);
    const expanded = (id: string) =>
      document.querySelector(`[data-delegation="${id}"] [aria-expanded]`)?.getAttribute('aria-expanded');
    await waitFor(() => {
      expect(expanded('child')).toBe('true');
      expect(expanded('grandchild')).toBe('true');
    });
  });
});
