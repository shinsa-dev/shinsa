import { afterEach, describe, expect, it } from 'bun:test';
import { act } from '@testing-library/react';
import { type EngineView, requestEngineRestart, resolveEngineView } from '@/lib/connection/engine.ts';
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
    expect(resolveEngineView(APP, createHealth(), null)).toEqual({
      banner: null,
      status: null,
      automatic: null,
      key: '',
    });
    expect(resolveEngineView(APP, createHealth({ version: '0.6.0' }), null).banner).toBeNull();
  });

  it('asks you to update the app when the engine speaks a newer protocol', () => {
    expect(resolveEngineView(APP, createHealth({ version: '0.6.0', protocol: 3 }), null)).toEqual({
      banner: {
        text: 'This app is older than Shinsa’s engine. Update Shinsa to keep working.',
        actions: ['update_app'],
      },
      status: { version: '0.6.0', label: 'Newer than this app', tone: 'orange' },
      automatic: null,
      key: '0.6.0:3',
    });
  });

  it('restarts an older engine at once with no banner, even while agents work or wait to hand over', () => {
    const moving: EngineView = {
      banner: null,
      status: { version: '0.4.0', label: 'Moving to 0.5.0…', tone: 'neutral' },
      automatic: 'now',
      key: '0.4.0:2',
    };
    expect(resolveEngineView(APP, createHealth({ version: '0.4.0' }), null)).toEqual(moving);
    expect(resolveEngineView(APP, createHealth({ version: '0.4.0', busy: true, working: 3 }), null)).toEqual(
      moving
    );
    expect(
      resolveEngineView(APP, createHealth({ version: '0.4.0', busy: true, restart: 'idle' }), null)
    ).toEqual(moving);
    const newProtocol = resolveEngineView(
      APP,
      createHealth({ version: '0.4.0', protocol: 1, busy: true }),
      null
    );
    expect(newProtocol.automatic).toBe('now');
    expect(newProtocol.banner).toBeNull();
  });

  it('warns when the engine could not restart', () => {
    expect(resolveEngineView(APP, createHealth({ version: '0.4.0' }), 'It runs from a terminal.')).toEqual({
      banner: {
        text: 'Restart Shinsa’s engine to finish updating to 0.5.0. It runs from a terminal.',
        actions: [],
      },
      status: { version: '0.4.0', label: 'Restart it to move to 0.5.0', tone: 'orange' },
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
