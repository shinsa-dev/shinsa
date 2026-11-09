import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  createSettings,
  HOUR_MS,
  MINUTE_MS,
  resolveEngineInfo,
  type Settings,
  type ShinsaState,
} from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AutoPaceSettings } from '@/components/settings/auto-pace.tsx';
import { ForecastSettings } from '@/components/settings/forecast.tsx';
import { createAccount, createSnapshot, createWindow } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { listSentCommands, pushAccounts, startFakeServer, stopFakeServer } from '../../support/server.ts';
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

function renderForecast(settings: Partial<Settings> = {}, usagePaces: ShinsaState['usagePaces'] = {}) {
  const state = createShinsaState({ patch: { usagePaces } });
  state.settings = { ...createSettings(), ...settings };
  return render(
    <TooltipProvider>
      <AutoPaceSettings state={state} />
      <ForecastSettings state={state} />
    </TooltipProvider>
  );
}

describe('Auto pace settings', () => {
  it('puts the Auto pace switch in its own section above the forecast, off by default, and turns it on', async () => {
    pushAccounts(createSnapshot({ accounts: ACCOUNTS }));
    await settle();
    renderForecast();
    const toggle = screen.getByRole('switch', { name: 'Auto pace' });
    const forecast = screen.getByText('Forecast');
    expect(toggle.compareDocumentPosition(forecast)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(toggle.closest('section')?.contains(forecast)).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/^Turn it on to start each build only when/)).toBeTruthy();
    expect(screen.queryByText(/^Left for .*builds/)).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { autoPace: true } }])
    );
  });

  it('shows what is left for builds under each provider while Auto pace is on', async () => {
    pushAccounts(createSnapshot({ accounts: ACCOUNTS }));
    await settle();
    renderForecast({ autoPace: true }, { claude: { provider: 'claude', pace: 140, at: Date.now() } });
    expect(screen.getByText(/^Each build starts only when its estimate fits/)).toBeTruthy();
    expect(screen.getByText('Left for Claude builds in the next 24 hours')).toBeTruthy();
    expect(screen.getByText('126% left')).toBeTruthy();
    expect(screen.getByText(/counting your usable usage resets/)).toBeTruthy();
  });

  it('waits for the first usage reading before it shows a budget', async () => {
    pushAccounts(createSnapshot({ accounts: ACCOUNTS }));
    await settle();
    renderForecast({ autoPace: true });
    expect(screen.getByText('Auto pace waits for the first usage reading of these accounts.')).toBeTruthy();
  });

  it('leaves Auto pace out on an engine that cannot pace builds', async () => {
    const engine = resolveEngineInfo('1.0.0');
    spyOnEngine({ ...engine, features: engine.features.filter((feature) => feature !== 'usage.auto_pace') });
    pushAccounts(createSnapshot({ accounts: ACCOUNTS }));
    await settle();
    renderForecast({ autoPace: true }, { claude: { provider: 'claude', pace: 140, at: Date.now() } });
    expect(screen.getByText('Forecast')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Auto pace' })).toBeNull();
    expect(screen.queryByText(/^Left for .*builds/)).toBeNull();
  });
});
