import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
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

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

describe('quiet notices in the chat', () => {
  it('shows an account switch with why it switched, and a compaction, as quiet rows', async () => {
    const task = createTask({ id: 'task-switch' });
    const run = createRun({
      id: 'run-switch',
      taskId: 'task-switch',
      startedAt: NOW,
      endedAt: NOW + 60_000,
      outcome: 'completed',
    });
    const state = createShinsaState({ tasks: [task], runs: [run] });
    pushState(state);
    render(
      <TooltipProvider>
        <ChatTab state={state} task={task} focusRunId={null} />
      </TooltipProvider>
    );
    pushTranscript('run-switch', [
      createEntry(
        {
          type: 'notice',
          notice: {
            kind: 'account_switched',
            email: 'b@example.com',
            previous: 'a@example.com',
            reason: 'usage_limit',
          },
        },
        'n1',
        NOW + 1000
      ),
      createEntry(
        {
          type: 'notice',
          notice: { kind: 'account_switched', email: null, previous: null, reason: 'bound' },
        },
        'n2',
        NOW + 2000
      ),
      createEntry(
        {
          type: 'notice',
          notice: { kind: 'compaction', trigger: 'auto', preTokens: 180_000, summary: null },
        },
        'n3',
        NOW + 2500
      ),
      createEntry({ type: 'agent', phase: 'final', text: 'Done.' }, 'a1', NOW + 3000),
    ]);
    const row = screen.getByText('Account switched · b@example.com');
    expect(screen.getByText('Account switched')).toBeTruthy();
    expect(screen.getByText('Conversation compacted')).toBeTruthy();
    expect(await findTooltipText(row.parentElement as HTMLElement)).toContain(
      'The previous account hit its usage limit.'
    );
  });

  it('shows a hand-over as a quiet row with where it went and how much carried over', async () => {
    const task = createTask({ id: 'task-handoff' });
    const run = createRun({
      id: 'run-handoff',
      taskId: 'task-handoff',
      startedAt: NOW,
      endedAt: NOW + 60_000,
      outcome: 'completed',
    });
    const state = createShinsaState({ tasks: [task], runs: [run] });
    pushState(state);
    render(
      <TooltipProvider>
        <ChatTab state={state} task={task} focusRunId={null} />
      </TooltipProvider>
    );
    pushTranscript('run-handoff', [
      createEntry(
        {
          type: 'notice',
          notice: {
            kind: 'handoff',
            reason: 'provider_switch',
            fromProvider: 'Claude',
            toProvider: 'Codex',
            totalEntries: 80,
            includedEntries: 80,
          },
        },
        'h1',
        NOW + 1000
      ),
      createEntry({ type: 'agent', phase: 'final', text: 'Done.' }, 'a1', NOW + 3000),
    ]);
    const row = screen.getByText('Conversation handed over · Codex');
    expect(await findTooltipText(row.parentElement as HTMLElement)).toBe(
      'From Claude to Codex. All 80 entries carried over.'
    );
  });
});
