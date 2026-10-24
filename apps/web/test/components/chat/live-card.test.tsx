import { afterEach, beforeEach, describe, expect, it, jest, setSystemTime } from 'bun:test';
import type { ChatEntry } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render } from '@testing-library/react';
import { RunSection } from '@/components/chat/run-section.tsx';
import {
  createEntry,
  pushState,
  pushTranscript,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

const STARTED = NOW - 120_000;

const task = createTask({ id: 'task-1' });

const run = createRun({ id: 'run-live', taskId: 'task-1', startedAt: STARTED });

function liveEntries(): ChatEntry[] {
  return [
    createEntry({ type: 'agent', phase: 'interim', text: 'Reading the form code.' }, 'a1', STARTED),
    createEntry(
      { type: 'tool_call', callId: 'c1', tool: { kind: 'read', path: 'src/form.ts', range: null } },
      'c1',
      STARTED + 1000
    ),
    createEntry(
      { type: 'tool_result', callId: 'c1', status: 'ok', output: '', images: [] },
      'r1',
      STARTED + 2000
    ),
    createEntry({ type: 'agent', phase: 'interim', text: 'Now running the tests.' }, 'a2', STARTED + 3000),
    createEntry(
      {
        type: 'tool_call',
        callId: 'c2',
        tool: { kind: 'command', action: 'run', command: 'bun test', description: null },
      },
      'c2',
      STARTED + 4000
    ),
  ];
}

function renderLive(waiting = false) {
  pushState(createShinsaState({ tasks: [task], runs: [run] }));
  return render(
    <TooltipProvider>
      <RunSection run={run} task={task} messages={[]} first waiting={waiting} />
    </TooltipProvider>
  );
}

function stepLine(view: ReturnType<typeof render>) {
  return view.getByRole('button', { expanded: false });
}

beforeEach(() => {
  startFakeServer();
  setSystemTime(new Date(NOW));
});

afterEach(() => {
  jest.useRealTimers();
  stopFakeServer();
  setSystemTime();
});

describe('LiveCard', () => {
  it('shows the latest interim message, not the earlier ones', () => {
    pushTranscript('run-live', liveEntries());
    const view = renderLive();
    expect(view.getByText('Now running the tests.')).toBeTruthy();
    expect(view.queryByText('Reading the form code.')).toBeNull();
    expect(view.queryByRole('button', { name: /Worked for/ })).toBeNull();
  });

  it('names the running tool call as the current step with the time and step count', () => {
    pushTranscript('run-live', liveEntries());
    const view = renderLive();
    expect(stepLine(view).textContent).toContain('Running bun test');
    expect(stepLine(view).textContent).toEndWith('2m · 2 steps');
  });

  it('says it is paused until you answer while a question is open', () => {
    pushTranscript('run-live', liveEntries());
    const view = renderLive(true);
    expect(stepLine(view).textContent).toBe('Paused until you answer2m · 2 steps');
  });

  it('says it is starting before the agent has done anything', () => {
    pushTranscript('run-live', []);
    const view = renderLive();
    expect(stepLine(view).textContent).toStartWith('Starting');
    expect(stepLine(view).textContent).not.toContain('step');
  });

  it('counts the time from the start of the run before the agent has done anything', () => {
    pushTranscript('run-live', []);
    const view = renderLive();
    expect(stepLine(view).textContent).toEndWith('2m');
  });

  it('keeps naming the last tool call once it has finished, instead of saying it is thinking', () => {
    pushTranscript('run-live', [
      ...liveEntries(),
      createEntry(
        { type: 'tool_result', callId: 'c2', status: 'ok', output: '', images: [] },
        'r2',
        NOW - 1000
      ),
    ]);
    const view = renderLive();
    expect(stepLine(view).textContent).toContain('Running bun test');
    expect(stepLine(view).textContent).not.toContain('Thinking');
    expect(stepLine(view).textContent).toEndWith('2m · 2 steps');
  });

  it('says it is thinking once the agent spoke after its last tool call', () => {
    pushTranscript('run-live', [
      ...liveEntries(),
      createEntry(
        { type: 'tool_result', callId: 'c2', status: 'ok', output: '', images: [] },
        'r2',
        NOW - 1000
      ),
      createEntry({ type: 'agent', phase: 'interim', text: 'The tests pass.' }, 'a3', NOW - 500),
    ]);
    const view = renderLive();
    expect(stepLine(view).textContent).toContain('Thinking');
  });

  it('keeps the duration running while the agent works', () => {
    jest.useFakeTimers();
    setSystemTime(new Date(NOW));
    pushTranscript('run-live', liveEntries());
    const view = renderLive();
    expect(stepLine(view).textContent).toContain('2m');
    setSystemTime(new Date(NOW + 60_000));
    act(() => jest.advanceTimersByTime(1000));
    expect(stepLine(view).textContent).toContain('3m');
  });

  it('swaps in a new interim message when one arrives', () => {
    pushTranscript('run-live', liveEntries());
    const view = renderLive();
    pushTranscript(
      'run-live',
      [createEntry({ type: 'agent', phase: 'interim', text: 'All tests pass.' }, 'a3', NOW - 500)],
      false
    );
    const shown = view.getByText('All tests pass.').closest('p') as HTMLElement;
    expect(shown.getAttribute('aria-live')).toBe('polite');
    const leaving = view.getByText('Now running the tests.').closest('p') as HTMLElement;
    expect(leaving.getAttribute('aria-hidden')).toBe('true');
    fireEvent.animationEnd(leaving);
    expect(view.queryByText('Now running the tests.')).toBeNull();
  });

  it('opens onto everything so far without repeating the latest message', () => {
    pushTranscript('run-live', liveEntries());
    const view = renderLive();
    fireEvent.click(stepLine(view));
    expect(view.getByText('Reading the form code.')).toBeTruthy();
    expect(view.getAllByText('Now running the tests.')).toHaveLength(1);
    expect(view.getByText('src/form.ts')).toBeTruthy();
  });
});
