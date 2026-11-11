import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createSettings, DAY_MS, HOUR_MS, resolveEngineInfo, type ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ActiveHoursSettings } from '@/components/settings/active-hours.tsx';
import { ACTIVE_HOURS_LABEL } from '@/lib/active-hours.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { listSentCommands, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState } from '../../support/state.ts';

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
  startFakeServer();
});

afterEach(() => {
  toasts.restore();
  stopFakeServer();
});

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function renderHours(patch: (state: ShinsaState) => void = () => undefined) {
  const state = createShinsaState({});
  state.settings = createSettings();
  state.timeZone = 'UTC';
  patch(state);
  return render(
    <TooltipProvider>
      <ActiveHoursSettings state={state} />
    </TooltipProvider>
  );
}

function learnWorkdays(state: ShinsaState) {
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  for (let day = 1; day <= 10; day++)
    for (let hour = 9; hour < 17; hour++) {
      const at = today - day * DAY_MS + hour * HOUR_MS;
      state.presence[String(Math.floor(at / HOUR_MS))] = 4;
    }
}

describe('Settings → Your hours', () => {
  it('shows only on an engine that learns your hours', () => {
    const engine = resolveEngineInfo('1.0.0');
    spyOnEngine({ ...engine, features: engine.features.filter((feature) => feature !== 'active-hours') });
    renderHours();
    expect(screen.queryByText(ACTIVE_HOURS_LABEL.title)).toBeNull();
  });

  it('says it is still learning, and sets weekdays 9 to 17 by hand', async () => {
    spyOnEngine();
    renderHours();
    expect(screen.getByText(ACTIVE_HOURS_LABEL.learning)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ACTIVE_HOURS_LABEL.setByHand }));
    await settle();
    expect(listSentCommands()).toEqual([
      {
        type: 'settings.change',
        patch: { activeHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, from: 9, to: 17 })) },
      },
    ]);
  });

  it('draws the learned hours as a week timeline, with today marked now', () => {
    spyOnEngine();
    const { container } = renderHours(learnWorkdays);
    expect(screen.getByText(/^Learned from what you did over/)).toBeTruthy();
    expect(screen.getByText('56 hours a week')).toBeTruthy();
    expect(screen.getByText(/^You are usually (active|away) now, until/)).toBeTruthy();
    const runs = container.querySelectorAll('[data-run="9-17"]');
    expect(runs).toHaveLength(7);
    expect((runs[0] as HTMLElement).style.left).toBe('37.5%');
    expect(container.querySelectorAll('[data-now]')).toHaveLength(1);
    expect(screen.getByText('Usually away')).toBeTruthy();
  });

  it('edits a day set by hand, and goes back to the learned hours', async () => {
    spyOnEngine();
    renderHours((state) => {
      state.settings.activeHours = [{ weekday: 1, from: 9, to: 17 }];
    });
    expect(screen.getByText('Set by hand, on UTC time.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Monday ends' }).textContent).toBe('17:00');
    expect(screen.queryByRole('combobox', { name: 'Tuesday ends' })).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'Monday ends' }));
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    const item = within(list).getByRole('option', { name: '19:00' });
    fireEvent.pointerDown(item, { pointerType: 'mouse' });
    fireEvent.click(item);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: ACTIVE_HOURS_LABEL.useLearned }));
    await settle();
    expect(listSentCommands()).toEqual([
      { type: 'settings.change', patch: { activeHours: [{ weekday: 1, from: 9, to: 19 }] } },
      { type: 'settings.change', patch: { activeHours: null } },
    ]);
  });
});
