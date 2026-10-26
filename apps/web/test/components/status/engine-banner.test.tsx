import { afterEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EngineBanner } from '@/components/status/engine-banner.tsx';
import { UpdateButton } from '@/components/status/update-button.tsx';
import { refreshHealth, type ServerHealth } from '@/lib/connection/health.ts';
import { installDesktop } from '../../support/desktop.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';

let desktop: ReturnType<typeof installDesktop> | null = null;
let fake: ReturnType<typeof startFakeOnboarding> | null = null;

afterEach(async () => {
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
  it('restarts an older engine once, by itself, while no agent is mid-turn', async () => {
    const view = await showEngine({ version: '0.4.0', protocol: 2 });
    await waitFor(() => expect(listRestarts()).toEqual([{ when: 'now' }]));
    expect(screen.getByText(/Restarting the engine into Shinsa 0.5.0/)).toBeTruthy();
    view.rerender(<EngineBanner />);
    expect(listRestarts()).toEqual([{ when: 'now' }]);
  });

  it('lets you choose when agents are working and the protocol changed', async () => {
    await showEngine({ version: '0.4.0', protocol: 1, busy: true }, { restarting: false });
    expect(listRestarts()).toEqual([]);
    const idle = screen.getByRole('button', { name: 'When agents are idle' });
    expect(idle.className).toContain('before:bg-primary');
    expect(screen.getByRole('button', { name: 'Restart now' }).className).not.toContain('before:bg-primary');
    fireEvent.click(idle);
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(listRestarts()).toEqual([{ when: 'idle' }, { when: 'now' }]));
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
  it('appears once an update is downloaded, and installs it', () => {
    desktop = installDesktop();
    const view = render(<UpdateButton />);
    expect(view.container.textContent).toBe('');
    act(() => desktop?.changeUpdate({ status: 'ready', version: '0.6.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(desktop.updateCalls).toEqual(['install']);
  });
});
