import { afterEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EngineBanner } from '@/components/status/engine-banner.tsx';
import { UpdateButton } from '@/components/status/update-button.tsx';
import { recordEngineFailure } from '@/lib/connection/engine.ts';
import { refreshHealth, type ServerHealth } from '@/lib/connection/health.ts';
import { installDesktop } from '../../support/desktop.ts';
import { findTooltipText } from '../../support/hover.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';

let desktop: ReturnType<typeof installDesktop> | null = null;
let fake: ReturnType<typeof startFakeOnboarding> | null = null;

afterEach(async () => {
  act(() => recordEngineFailure(null));
  fake?.stop();
  fake = startFakeOnboarding({ 'GET /api/health': { answer: { ok: true, seq: 1, problems: [] } } });
  await act(() => refreshHealth());
  fake.stop();
  fake = null;
  desktop?.restore();
  desktop = null;
});

async function showEngine(
  health: Partial<ServerHealth>,
  restart: unknown = { restarting: true },
  status = 200
) {
  desktop = installDesktop();
  desktop.bridge.version = '0.5.0';
  desktop.bridge.protocol = 2;
  fake = startFakeOnboarding({
    'GET /api/health': { answer: { ok: true, seq: 1, problems: [], busy: false, restart: null, ...health } },
    'POST /api/engine/restart': { answer: restart, status },
  });
  await act(() => refreshHealth());
  return render(<EngineBanner />);
}

function listRestarts() {
  return fake?.requests
    .filter((request) => request.path === '/api/engine/restart')
    .map((request) => request.body);
}

describe('the engine banner', () => {
  it('restarts an older engine once, by itself and without a banner, even while agents work', async () => {
    const view = await showEngine({ version: '0.4.0', protocol: 2, busy: true, working: 3 });
    await waitFor(() => expect(listRestarts()).toEqual([{ when: 'now' }]));
    expect(view.container.textContent).toBe('');
    view.rerender(<EngineBanner />);
    expect(listRestarts()).toEqual([{ when: 'now' }]);
  });

  it('says what to do when the engine cannot restart itself', async () => {
    await showEngine(
      { version: '0.4.0', protocol: 2 },
      { error: { code: 'restart_unsupported', message: 'Stop it and start it again.' } },
      400
    );
    expect(await screen.findByText(/finish updating to 0.5.0. Stop it and start it again./)).toBeTruthy();
  });

  it('asks you to update the app for a newer engine, installing an update that is ready', async () => {
    await showEngine({ version: '0.7.0', protocol: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Update Shinsa' }));
    desktop?.changeUpdate({ status: 'ready', version: '0.7.0' });
    fireEvent.click(screen.getByRole('button', { name: 'Update Shinsa' }));
    expect(desktop?.updateCalls).toEqual(['check', 'install']);
  });

  it('shows nothing when the app and the engine match', async () => {
    const view = await showEngine({ version: '0.5.0', protocol: 2 });
    expect(view.container.textContent).toBe('');
  });
});

describe('the update button', () => {
  it('appears once an update is downloaded, says agents keep working, and installs it', async () => {
    desktop = installDesktop();
    const view = render(
      <TooltipProvider>
        <UpdateButton />
      </TooltipProvider>
    );
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    act(() => desktop?.changeUpdate({ status: 'ready', version: '0.6.0' }));
    expect(await findTooltipText(screen.getByRole('button', { name: 'Update' }))).toBe(
      'Shinsa 0.6.0 is ready. The app restarts, then the engine follows on its own and agents pick up where they were.'
    );
    view.unmount();
    render(<UpdateButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(desktop.updateCalls).toEqual(['install']);
  });
});
