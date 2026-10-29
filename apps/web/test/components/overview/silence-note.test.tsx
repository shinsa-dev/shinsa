import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, render, screen } from '@testing-library/react';
import { SilenceNote } from '@/components/overview/silence-note.tsx';
import { createEntry, pushTranscript, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createRun, createShinsaState, NOW } from '../../support/state.ts';

const MINUTE = 60_000;

beforeEach(() => {
  startFakeServer();
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
});

afterEach(() => {
  stopFakeServer();
});

function renderNote(snoozedUntil: number | null) {
  const run = createRun({
    id: 'run-1',
    taskId: 'task-1',
    status: 'running',
    silence: { since: NOW - 10 * MINUTE, snoozedUntil, dismissed: false },
  });
  return render(
    <TooltipProvider>
      <SilenceNote state={createShinsaState({ runs: [run] })} run={run} />
    </TooltipProvider>
  );
}

function tickTo(at: number) {
  act(() => {
    jest.setSystemTime(new Date(at - MINUTE));
    jest.advanceTimersByTime(MINUTE);
  });
}

describe('the quiet-agent note', () => {
  it('turns orange once the agent has been quiet for 15 minutes, without anything else changing', () => {
    renderNote(null);
    expect(screen.getByText('No output for 10 minutes').closest('.text-orange-text')).toBeNull();
    tickTo(NOW + 6 * MINUTE);
    expect(screen.getByText('No output for 16 minutes').closest('.text-orange-text')).not.toBeNull();
  });

  it('comes back when a snooze runs out', () => {
    renderNote(NOW + 2 * MINUTE);
    expect(screen.queryByText(/^No output for/)).toBeNull();
    tickTo(NOW + 3 * MINUTE);
    expect(screen.getByText(/^No output for/)).toBeTruthy();
  });

  it('says a command is still running, and which, instead of no output', () => {
    pushTranscript('run-1', [
      createEntry(
        {
          type: 'tool_call',
          callId: 'c1',
          tool: {
            kind: 'command',
            action: 'run',
            command: 'bun test --cwd apps/engine test/checks\necho done',
            description: null,
          },
        },
        'c1',
        NOW - 10 * MINUTE
      ),
    ]);
    renderNote(null);
    expect(screen.getByText('A command has been running for 10 minutes')).toBeTruthy();
    expect(screen.getByText('bun test --cwd apps/engine test/checks').className).toContain('font-mono');
    expect(screen.queryByText(/^No output for/)).toBeNull();
    expect(screen.getByText('Snooze')).toBeTruthy();
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });

  it('keeps no output once the command has finished', () => {
    pushTranscript('run-1', [
      createEntry(
        {
          type: 'tool_call',
          callId: 'c1',
          tool: { kind: 'command', action: 'run', command: 'bun test src/a', description: null },
        },
        'c1',
        NOW - 11 * MINUTE
      ),
      createEntry(
        { type: 'tool_result', callId: 'c1', status: 'ok', output: '3 pass', images: [] },
        'r1',
        NOW - 10 * MINUTE
      ),
    ]);
    renderNote(null);
    expect(screen.getByText('No output for 10 minutes')).toBeTruthy();
    expect(screen.queryByText('bun test src/a')).toBeNull();
  });
});
