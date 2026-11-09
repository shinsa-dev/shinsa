import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  createSettings,
  HOUR_MS,
  listForecastAccounts,
  MINUTE_MS,
  resolveUsageForecast,
  type Settings,
  type ShinsaState,
} from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ForecastSettings } from '@/components/settings/forecast.tsx';
import { createAccount, createSnapshot, createWindow } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { pushAccounts, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState } from '../../support/state.ts';

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
  startFakeServer();
  spyOnEngine();
});

afterEach(() => {
  toasts.restore();
  stopFakeServer();
});

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function weeklyAccount(id: string, usedPercent: number, resetsIn: number) {
  const minute = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  return createAccount({
    id,
    usage: {
      status: 'ok',
      windows: [
        createWindow({ id: `${id}-weekly`, kind: 'weekly', usedPercent, resetsAt: minute + resetsIn }),
      ],
      detail: null,
      checkedAt: Date.now(),
      source: 'read',
    },
  });
}

const ACCOUNTS = [weeklyAccount('overclock', 92, 15 * HOUR_MS), weeklyAccount('home', 79, 63 * HOUR_MS)];

function expectedPace() {
  const now = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const forecast = resolveUsageForecast(listForecastAccounts(ACCOUNTS, now), now);
  return forecast?.safePace ?? 0;
}

function renderForecast(settings: Partial<Settings> = {}, usagePaces: ShinsaState['usagePaces'] = {}) {
  const state = createShinsaState({ patch: { usagePaces } });
  state.settings = { ...createSettings(), ...settings };
  return render(
    <TooltipProvider>
      <ForecastSettings state={state} />
    </TooltipProvider>
  );
}

describe('the usage forecast', () => {
  it('shows nothing until an account has a weekly limit', async () => {
    pushAccounts(createSnapshot({ accounts: [createAccount({ id: 'a' })] }));
    await settle();
    renderForecast();
    expect(screen.queryByText('Forecast')).toBeNull();
  });

  it('shows the safe pace, a lane per account and the tightest point, with nothing to apply as a daily limit', async () => {
    pushAccounts(createSnapshot({ accounts: ACCOUNTS }));
    await settle();
    const { container } = renderForecast();
    const pace = expectedPace();
    expect(screen.getByText('Forecast')).toBeTruthy();
    expect(screen.getByText(`${Number(pace.toFixed(1))}% a day`)).toBeTruthy();
    expect(screen.getByText('overclock@example.com')).toBeTruthy();
    expect(screen.getByText('home@example.com')).toBeTruthy();
    expect(screen.getByText(/^Tightest point at the safe pace: /)).toBeTruthy();
    expect(screen.getByText('No measured usage in the last 24 hours.')).toBeTruthy();
    expect(screen.getByText('Every account out of usage')).toBeTruthy();
    expect(container.querySelector('[data-outage]')).toBeNull();
    expect(container.querySelectorAll('[data-tightest]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-usable]').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelectorAll('[data-reset-gap]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-usable]:not([data-reset-gap])')).toHaveLength(2);
    expect(container.querySelector('[data-reset]')).toBeNull();
    expect(screen.queryByText('Reset')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: `${Number((pace * 2).toFixed(1))}%` }));
    expect(container.querySelectorAll('[data-outage]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-tightest]')).toBeNull();
    expect(
      screen.getByText(/^At .+% a day every account is out of usage for .+ in all, starting in .+\.$/)
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use as daily limit' })).toBeNull();
  });

  it('marks where every account is out of usage at once', async () => {
    pushAccounts(createSnapshot({ accounts: [weeklyAccount('spent', 100, 15 * HOUR_MS)] }));
    await settle();
    const { container } = renderForecast();
    expect(container.querySelectorAll('[data-outage]')).toHaveLength(1);
    expect(
      screen.getByText('At 0% a day every account is out of usage for 15h in all, starting now.')
    ).toBeTruthy();
  });

  it('stacks the outage band above the lanes so its hint wins the hover', async () => {
    pushAccounts(createSnapshot({ accounts: [weeklyAccount('spent', 100, 15 * HOUR_MS)] }));
    await settle();
    const { container } = renderForecast();
    const outage = container.querySelector('[data-outage]');
    const overlay = outage?.closest('[data-overlay]');
    expect(overlay?.classList.contains('z-10')).toBe(true);
    expect(overlay?.classList.contains('pointer-events-none')).toBe(true);
    expect(outage?.classList.contains('pointer-events-auto')).toBe(true);
    const lane = container.querySelector('[data-usable]')?.closest('.relative');
    expect(overlay?.compareDocumentPosition(lane as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
