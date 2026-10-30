import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HOUR_MS, type Watchdog } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WatchdogsPanel } from '@/components/overview/watchdogs-panel.tsx';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask, NOW } from '../../support/state.ts';

function watchdog(overrides: Partial<Watchdog>): Watchdog {
  return {
    id: 'w1',
    round: 1,
    title: 'Checkout latency',
    check: 'p95 of POST /checkout under 400 ms.',
    source: { server: 'maple', data: 'Traces' },
    sourceRequest: null,
    firstCheckMinutes: 360,
    maxGapMinutes: 360,
    forMinutes: 2_880,
    startsOn: 'merge',
    productionCheck: null,
    status: 'watching',
    armedAt: NOW,
    awaitingSince: null,
    startedAt: NOW,
    endsAt: NOW + 31 * HOUR_MS,
    nextCheckAt: NOW + 6 * HOUR_MS,
    runId: null,
    checks: [{ at: NOW, healthy: true, summary: 'p95 is 210 ms.' }],
    forkTaskIds: [],
    endedAt: null,
    ...overrides,
  };
}

const WAITING = watchdog({
  id: 'w2',
  title: 'Paywall events',
  status: 'needs_source',
  source: null,
  startedAt: null,
  endsAt: null,
  nextCheckAt: null,
  checks: [],
  sourceRequest: {
    data: 'Web analytics events',
    evidence: '`src/analytics.ts` sends them to PostHog.',
    suggestions: ['PostHog’s official MCP server', 'Composio’s PostHog toolkit'],
  },
});

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

function renderPanel(watchdogs: Watchdog[]) {
  const task = createTask({ id: 't', stage: 'merged', watchdogs });
  const fork = createTask({ id: 'fork', handle: 'SW-46', title: 'Fix the docs in Safari' });
  const state = createShinsaState({ tasks: [task, fork] });
  pushState(state);
  render(
    <TooltipProvider>
      <WatchdogsPanel state={state} task={task} now={NOW} />
    </TooltipProvider>
  );
}

function rowOf(title: string) {
  return screen.getByText(title).closest('li') as HTMLElement;
}

describe('the watchdogs panel', () => {
  it('shows nothing without watchdogs', () => {
    const task = createTask({ id: 't' });
    const { container } = render(<WatchdogsPanel state={createShinsaState({ tasks: [task] })} task={task} />);
    expect(container.textContent).toBe('');
  });

  it('lists each watchdog with its status, schedule, source and last check, and stops one', async () => {
    renderPanel([watchdog({}), watchdog({ id: 'w3', title: 'Done one', status: 'passed' })]);
    expect(screen.getByText(/1 watchdog · 31 h left/)).toBeTruthy();
    const row = rowOf('Checkout latency');
    expect(within(row).getByText('Watching')).toBeTruthy();
    expect(row.textContent).toContain('31 h left · 1 check');
    expect(row.textContent).toContain('p95 is 210 ms.');
    expect(row.textContent).not.toContain('First check after');
    expect(within(rowOf('Done one')).queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'watchdog.stop', taskId: 't', watchdogId: 'w1' }])
    );
  });

  it('shows what a watchdog checks and how often in a card on its status', async () => {
    renderPanel([watchdog({})]);
    const row = rowOf('Checkout latency');
    expect(within(row).queryByRole('button', { name: 'Checkout latency' })).toBeNull();
    fireEvent.focus(within(row).getByRole('button', { name: 'Watching' }));
    expect(await screen.findByText('p95 of POST /checkout under 400 ms.')).toBeTruthy();
    expect(screen.getByText('First check after 6 h, then up to every 6 h, for 48 h · maple')).toBeTruthy();
  });

  it('links the task a watchdog filed when it found an issue', async () => {
    renderPanel([watchdog({ status: 'tripped', forkTaskIds: ['fork'] })]);
    const row = rowOf('Checkout latency');
    await waitFor(() =>
      expect(row.querySelector('a[data-task="fork"]')?.getAttribute('href')).toBe('/tasks/SW-46')
    );
    expect(row.textContent).toContain('Filed');
  });

  it('asks for a data source with the evidence and suggestions, and connects one you name', async () => {
    renderPanel([WAITING]);
    const row = rowOf('Paywall events');
    expect(row.textContent).toContain('It needs Web analytics events.');
    expect(row.textContent).toContain('PostHog toolkit');
    const connect = within(row).getByRole('button', { name: 'Connect' }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.change(within(row).getByRole('textbox', { name: 'MCP server' }), {
      target: { value: 'posthog' },
    });
    fireEvent.click(connect);
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        {
          type: 'watchdog.connect',
          taskId: 't',
          watchdogId: 'w2',
          server: 'posthog',
          data: 'Web analytics events',
        },
      ])
    );
  });
});
