import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatTab } from '@/routes/task/chat.tsx';
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

describe('notices in the chat', () => {
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
    const rows = screen.getAllByRole('button', { name: /^Account switched/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      'Account switched · b@example.com',
      'Account switched',
    ]);
    expect(screen.getByText('· b@example.com').className).toContain('text-fg-2');
    expect(screen.getByText('Conversation compacted')).toBeTruthy();
    const [first] = rows;
    if (!first) throw new Error('no row');
    expect(first.hasAttribute('data-chat-line')).toBe(true);
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('The previous account hit its usage limit.')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: /^Conversation handed over/ }));
    expect(screen.getByText('· Codex')).toBeTruthy();
    expect(screen.getByText('From Claude to Codex. All 80 entries carried over.')).toBeTruthy();
  });

  it('opens what a run loaded, each group listed with its tokens', () => {
    const task = createTask({ id: 'task-loaded' });
    const run = createRun({
      id: 'run-loaded',
      taskId: 'task-loaded',
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
    pushTranscript('run-loaded', [
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
        NOW + 1000
      ),
      createEntry({ type: 'agent', phase: 'final', text: 'Done.' }, 'a1', NOW + 3000),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /^Loaded 1 MCP/ }));
    expect(screen.getByText('· ~4.2k tokens')).toBeTruthy();
    expect(screen.getByText('MCPs')).toBeTruthy();
    expect(screen.getByText('linear')).toBeTruthy();
  });
});
