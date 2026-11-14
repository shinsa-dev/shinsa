import { describe, expect, test } from 'bun:test';
import type { AppUpdateReport } from '@shinsa/core/engine-api/schema';
import {
  isReportFresh,
  resolveAppUpdatesView,
  resolveCarryingApp,
  resolveInstallProgress,
  resolveQueuedRequests,
} from '../../src/app-updates/control.ts';
import { type AppInstall, EMPTY_CONTROL } from '../../src/app-updates/schema.ts';

const ENGINE = { version: '1.4.0', protocol: 1 };

const READY: AppUpdateReport = {
  version: '1.4.0',
  protocol: 1,
  channel: 'stable',
  update: { status: 'ready', version: '1.5.0' },
};

const INSTALL: AppInstall = { from: '1.4.0', to: '1.5.0', handed: false, requestedAt: 1_000 };

describe('app updates control', () => {
  test('finds the app that carries the engine, and none for an engine installed another way', () => {
    expect(resolveCarryingApp('/Applications/Shinsa.app/Contents/Resources/engine/bin/shinsa')).toBe(
      '/Applications/Shinsa.app'
    );
    expect(resolveCarryingApp('/Users/kai/.local/share/shinsa/bin/shinsa')).toBeNull();
  });

  test('counts the app as running for 15 seconds after its last report', () => {
    const control = { ...EMPTY_CONTROL, report: READY, reportedAt: 1_000 };
    expect(isReportFresh(EMPTY_CONTROL, 1_000)).toBe(false);
    expect(isReportFresh(control, 16_000)).toBe(true);
    expect(isReportFresh(control, 16_001)).toBe(false);
  });

  test('keeps one request of each kind, the newest last', () => {
    const queued = resolveQueuedRequests([{ kind: 'channel', channel: 'beta' }, { kind: 'check' }], {
      kind: 'channel',
      channel: 'canary',
    });
    expect(queued).toEqual([{ kind: 'check' }, { kind: 'channel', channel: 'canary' }]);
  });

  test('restarts the engine once the app relaunches on a newer version than the engine', () => {
    const relaunched = { ...READY, version: '1.5.0', update: { status: 'none' as const } };
    expect(resolveInstallProgress(INSTALL, relaunched, ENGINE, 2_000)).toBe('restart_engine');
    expect(resolveInstallProgress(INSTALL, relaunched, { version: '1.5.0', protocol: 1 }, 2_000)).toBe(
      'installed'
    );
  });

  test('waits while the update is ready or installing, and gives up when it failed, was dropped or took too long', () => {
    const installing = { ...READY, update: { status: 'installing' as const, version: '1.5.0' } };
    expect(resolveInstallProgress(INSTALL, READY, ENGINE, 2_000)).toBe('waiting');
    expect(resolveInstallProgress({ ...INSTALL, handed: true }, installing, ENGINE, 2_000)).toBe('waiting');
    expect(
      resolveInstallProgress(
        { ...INSTALL, handed: true },
        { ...READY, update: { status: 'none' } },
        ENGINE,
        2_000
      )
    ).toBe('abandoned');
    expect(
      resolveInstallProgress(INSTALL, { ...READY, update: { status: 'failed', message: 'x' } }, ENGINE, 2_000)
    ).toBe('abandoned');
    expect(resolveInstallProgress(INSTALL, READY, ENGINE, 1_000 + 5 * 60_000 + 1)).toBe('abandoned');
  });

  test('describes the machine: where the engine came from, whether the app answers and what it installs', () => {
    expect(resolveAppUpdatesView(EMPTY_CONTROL, null, ENGINE, 1_000)).toEqual({
      source: 'standalone',
      running: false,
      app: null,
      installing: null,
      engine: ENGINE,
    });
    const control = { ...EMPTY_CONTROL, report: READY, reportedAt: 1_000, install: INSTALL };
    expect(resolveAppUpdatesView(control, null, ENGINE, 2_000)).toEqual({
      source: 'app',
      running: true,
      app: READY,
      installing: '1.5.0',
      engine: ENGINE,
    });
    expect(
      resolveAppUpdatesView(control, '/Applications/Shinsa.app', ENGINE, 1_000 + 5 * 60_000 + 1)
    ).toMatchObject({ source: 'app', running: false, installing: null });
  });
});
