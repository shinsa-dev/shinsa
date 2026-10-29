import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScheduleSettings } from '@/components/settings/schedules.tsx';
import { spyOnCommands } from '../../support/commands.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { createSchedule } from '../../support/schedules.ts';
import { createShinsaState, createTask, NOW } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

function renderSchedules(schedules: ReturnType<typeof createSchedule>[]) {
  const state = createShinsaState({
    tasks: [createTask({ id: 't-1', title: 'Nightly audit' })],
    patch: { schedules: Object.fromEntries(schedules.map((schedule) => [schedule.id, schedule])) },
  });
  return render(
    <TooltipProvider>
      <ScheduleSettings state={state} />
    </TooltipProvider>
  );
}

async function openMenu(index = 0) {
  fireEvent.click(screen.getAllByRole('button', { name: 'Automation options' })[index] as HTMLElement);
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('Settings → Schedules', () => {
  it('says how schedules appear when there are none', () => {
    renderSchedules([]);
    expect(
      screen.getByText(
        'Create a schedule, a trigger or a watch, or ask an agent for one, and it shows up here.'
      )
    ).toBeDefined();
  });

  it('lists each schedule with when it runs and its state', () => {
    renderSchedules([
      createSchedule({ id: 'a', name: 'Audit', nextRunAt: NOW + 60_000 }),
      createSchedule({ id: 'b', name: 'Paused one', enabled: false }),
      createSchedule({
        id: 'c',
        name: 'Pushes',
        trigger: { kind: 'webhook', signature: null, replayKey: null },
        nextRunAt: null,
      }),
    ]);
    expect(screen.getByText('Audit')).toBeDefined();
    expect(screen.getAllByText('Schedule · Starts a new task · every hour')).toHaveLength(2);
    expect(screen.getByText(/^Next at /).tagName).toBe('TIME');
    expect(screen.getByText('Paused')).toBeDefined();
    expect(screen.getByText('Trigger · Starts a new task · when its webhook is called')).toBeDefined();
  });

  it('pauses a schedule from its menu', async () => {
    renderSchedules([createSchedule({ id: 'a', name: 'Audit', lastTaskId: 't-1' })]);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'schedule.enable', scheduleId: 'a', enabled: false },
      '“Audit” is paused.'
    );
  });

  it('resumes a paused schedule and opens its task', async () => {
    renderSchedules([
      createSchedule({ id: 'a', name: 'Audit', enabled: false, target: { kind: 'task', taskId: 't-1' } }),
    ]);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resume' }));
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'schedule.enable', scheduleId: 'a', enabled: true },
      '“Audit” runs again.'
    );
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open the task' }));
    expect(location.pathname).toBe('/tasks/t-1');
  });

  it('opens a watch on its own page, never its home task', async () => {
    renderSchedules([
      createSchedule({
        id: 'w',
        name: 'Feedback',
        source: { projectId: 'p1', server: 'slack' },
        target: { kind: 'task', taskId: 't-1' },
      }),
    ]);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open the watch' }));
    expect(location.pathname).toBe('/automations/w');
  });

  it('creates an automation from its form', async () => {
    renderSchedules([]);
    fireEvent.click(screen.getByRole('button', { name: 'New automation' }));
    expect(screen.getByText('Reads an integration and files a task per new report')).toBeDefined();
    expect(screen.getByText(/No project uses an integration yet/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(screen.getByText('Say what it should do.')).toBeDefined();
  });

  it('copies a webhook’s URL', async () => {
    const fake = startFakeOnboarding({
      'GET /api/schedules/c/webhook': { answer: { url: 'http://localhost/api/hooks/c/x', hasSecret: false } },
    });
    renderSchedules([
      createSchedule({
        id: 'c',
        name: 'Pushes',
        trigger: { kind: 'webhook', signature: null, replayKey: null },
      }),
    ]);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy webhook URL' }));
    await waitFor(() => expect(spies.copied).toHaveBeenCalledWith('http://localhost/api/hooks/c/x'));
    fake.stop();
  });

  it('deletes a schedule only after the confirm dialog', async () => {
    renderSchedules([createSchedule({ id: 'a', name: 'Audit' })]);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete automation' }));
    expect(screen.getByText('Delete “Audit”?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(spies.sent).not.toHaveBeenCalled();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete automation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete automation' }));
    expect(spies.sent).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(spies.sent).toHaveBeenCalledWith(
        { type: 'schedule.remove', scheduleId: 'a' },
        'Deleted “Audit”.'
      )
    );
  });
});
