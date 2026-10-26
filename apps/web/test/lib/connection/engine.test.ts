import { afterEach, describe, expect, it } from 'bun:test';
import { act } from '@testing-library/react';
import { requestEngineRestart, resolveEngineView } from '@/lib/connection/engine.ts';
import { refreshHealth, type ServerHealth } from '@/lib/connection/health.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';

const APP = { version: '0.5.0', protocol: 2 };

function createHealth(patch: Partial<ServerHealth> = {}): ServerHealth {
  return {
    ok: true,
    seq: 1,
    problems: [],
    version: '0.5.0',
    protocol: 2,
    busy: false,
    restart: null,
    ...patch,
  };
}

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

afterEach(async () => {
  fake = startFakeOnboarding({ 'GET /api/health': { answer: { ok: true, seq: 1, problems: [] } } });
  await act(() => refreshHealth());
  fake.stop();
  fake = null;
});

describe('resolveEngineView', () => {
  it('says nothing in a browser, before the engine answers, or for an engine that reports no protocol', () => {
    expect(resolveEngineView(null, createHealth(), null).banner).toBeNull();
    expect(resolveEngineView(APP, null, null).banner).toBeNull();
    expect(resolveEngineView(APP, { ok: true, seq: 1, problems: [] }, null).banner).toBeNull();
  });

  it('says nothing when app and engine match, or the engine is newer on the same protocol', () => {
    expect(resolveEngineView(APP, createHealth(), null)).toEqual({ banner: null, automatic: null, key: '' });
    expect(resolveEngineView(APP, createHealth({ version: '0.6.0' }), null).banner).toBeNull();
  });

  it('asks you to update the app when the engine speaks a newer protocol', () => {
    expect(resolveEngineView(APP, createHealth({ version: '0.6.0', protocol: 3 }), null)).toEqual({
      banner: {
        tone: 'warning',
        text: 'This app is older than Shinsa’s engine. Update Shinsa to keep working.',
        actions: ['update_app'],
      },
      automatic: null,
      key: '0.6.0:3',
    });
  });

  it('restarts an older engine at once while no agent is mid-turn', () => {
    expect(resolveEngineView(APP, createHealth({ version: '0.4.0' }), null)).toEqual({
      banner: {
        tone: 'info',
        text: 'Restarting the engine into Shinsa 0.5.0. Agents pick up where they were.',
        actions: [],
      },
      automatic: 'now',
      key: '0.4.0:2',
    });
    expect(resolveEngineView(APP, createHealth({ version: '0.4.0', protocol: 1 }), null).automatic).toBe(
      'now'
    );
  });

  it('waits for agents on the same protocol, and lets you choose on a new one', () => {
    const later = resolveEngineView(APP, createHealth({ version: '0.4.0', busy: true }), null);
    expect(later.automatic).toBe('idle');
    expect(later.banner).toEqual({
      tone: 'info',
      text: 'The engine restarts into Shinsa 0.5.0 once agents are idle.',
      actions: ['restart_now'],
    });
    const choose = resolveEngineView(APP, createHealth({ version: '0.4.0', protocol: 1, busy: true }), null);
    expect(choose.automatic).toBeNull();
    expect(choose.banner).toEqual({
      tone: 'warning',
      text: 'Shinsa 0.5.0 needs its engine restarted.',
      actions: ['restart_now', 'restart_idle'],
    });
  });

  it('shows a restart the engine already waits for, and a restart it could not do', () => {
    const waiting = resolveEngineView(
      APP,
      createHealth({ version: '0.4.0', busy: true, restart: 'idle' }),
      null
    );
    expect(waiting.automatic).toBeNull();
    expect(waiting.banner?.actions).toEqual(['restart_now']);
    const failed = resolveEngineView(APP, createHealth({ version: '0.4.0' }), 'It runs from a terminal.');
    expect(failed).toEqual({
      banner: {
        tone: 'warning',
        text: 'Restart Shinsa’s engine to finish updating to 0.5.0. It runs from a terminal.',
        actions: [],
      },
      automatic: null,
      key: '0.4.0:2',
    });
  });
});

describe('requestEngineRestart', () => {
  it('asks the engine to restart, then reads its health again', async () => {
    fake = startFakeOnboarding({
      'POST /api/engine/restart': { answer: { restarting: false } },
      'GET /api/health': { answer: createHealth({ restart: 'idle' }) },
    });
    expect(await requestEngineRestart('idle')).toEqual({ restarting: false });
    expect(fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /api/engine/restart',
      'GET /api/health',
    ]);
    expect(fake.requests[0]?.body).toEqual({ when: 'idle' });
  });
});
