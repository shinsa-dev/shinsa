import { describe, expect, test } from 'bun:test';
import { DomainError, type EngineRestartWhen } from '@shinsa/core';
import type { AppUpdateReport } from '@shinsa/core/engine-api/schema';
import { Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { AppOpenFailed, type AppUpdatesInput } from '../../src/app-updates/schema.ts';
import { AppUpdates } from '../../src/app-updates/service.ts';
import { RestartFailed } from '../../src/instance/restart/schema.ts';
import { EngineRestarter } from '../../src/instance/restart/service.ts';
import { JsonLogger } from '../../src/log/service.ts';

const APP = '/Applications/Shinsa.app';

const READY: AppUpdateReport = {
  version: '1.4.0',
  protocol: 1,
  channel: 'stable',
  update: { status: 'ready', version: '1.5.0' },
};

const RELAUNCHED: AppUpdateReport = { ...READY, version: '1.5.0', update: { status: 'none' } };

interface Harness {
  restarts: EngineRestartWhen[];
  opened: string[];
}

function run<A, E>(
  body: (updates: AppUpdates['Service'], harness: Harness) => Effect.Effect<A, E>,
  options: { app?: string | null; restarter?: boolean; restartFails?: boolean; openFails?: boolean } = {}
) {
  const harness: Harness = { restarts: [], opened: [] };
  const input: AppUpdatesInput = {
    app: options.app === undefined ? APP : options.app,
    engine: { version: '1.4.0', protocol: 1 },
    open: (app) =>
      options.openFails
        ? Effect.fail(new AppOpenFailed({ message: 'LSOpenURLsWithRole() failed' }))
        : Effect.sync(() => {
            harness.opened.push(app);
          }),
  };
  const restarter = Layer.succeed(
    EngineRestarter,
    EngineRestarter.of({
      pending: Effect.succeed(null),
      deadlineAt: Effect.succeed(null),
      activity: Effect.succeed({ busy: false, working: 0, restart: null, restartBy: null }),
      request: (when) =>
        options.restartFails
          ? Effect.fail(new RestartFailed({ message: 'launchctl refused' }))
          : Effect.sync(() => {
              harness.restarts.push(when);
              return { restarting: true };
            }),
    })
  );
  const layer = AppUpdates.layer(input).pipe(
    Layer.provide(options.restarter === false ? Layer.empty : restarter),
    Layer.provideMerge(JsonLogger)
  );
  return Effect.runPromise(
    AppUpdates.use((updates) => Effect.andThen(TestClock.setTime(1_000), body(updates, harness))).pipe(
      Effect.provide(Layer.merge(layer, TestClock.layer()))
    )
  );
}

describe('AppUpdates', () => {
  test('keeps the last report and hands the app the requests queued since, once', () =>
    run((updates) =>
      Effect.gen(function* () {
        expect(yield* updates.report(READY)).toEqual({ requests: [] });
        yield* updates.request({ kind: 'check' });
        yield* updates.request({ kind: 'channel', channel: 'beta' });
        expect(yield* updates.report(READY)).toEqual({
          requests: [{ kind: 'check' }, { kind: 'channel', channel: 'beta' }],
        });
        expect(yield* updates.report(READY)).toEqual({ requests: [] });
        expect(yield* updates.view).toEqual({
          source: 'app',
          running: true,
          app: READY,
          installing: null,
          engine: { version: '1.4.0', protocol: 1 },
        });
      })
    ));

  test('installs a ready update, then restarts the engine now once the app relaunches on it', () =>
    run((updates, harness) =>
      Effect.gen(function* () {
        yield* updates.report(READY);
        expect((yield* updates.request({ kind: 'install' })).installing).toBe('1.5.0');
        expect(yield* updates.report(READY)).toEqual({ requests: [{ kind: 'install' }] });
        yield* updates.report({ ...READY, update: { status: 'installing', version: '1.5.0' } });
        yield* TestClock.adjust('20 seconds');
        expect(yield* updates.view).toMatchObject({ running: false, installing: '1.5.0' });
        expect(harness.restarts).toEqual([]);
        yield* updates.report(RELAUNCHED);
        expect(harness.restarts).toEqual(['now']);
        expect((yield* updates.view).installing).toBeNull();
        yield* updates.report(RELAUNCHED);
        expect(harness.restarts).toEqual(['now']);
      })
    ));

  test('never restarts on a newer app it was not asked to install', () =>
    run((updates, harness) =>
      Effect.gen(function* () {
        yield* updates.report(RELAUNCHED);
        expect(harness.restarts).toEqual([]);
      })
    ));

  test('drops an install the app did not carry out', () =>
    run((updates, harness) =>
      Effect.gen(function* () {
        yield* updates.report(READY);
        yield* updates.request({ kind: 'install' });
        yield* updates.report(READY);
        yield* updates.report({ ...READY, update: { status: 'current' } });
        expect((yield* updates.view).installing).toBeNull();
        expect(harness.restarts).toEqual([]);
      })
    ));

  test('logs a restart that fails, and goes without one where the engine cannot restart', async () => {
    const install = (updates: AppUpdates['Service']) =>
      Effect.gen(function* () {
        yield* updates.report(READY);
        yield* updates.request({ kind: 'install' });
        yield* updates.report(READY);
        yield* updates.report(RELAUNCHED);
        return yield* updates.view;
      });
    expect((await run(install, { restartFails: true })).installing).toBeNull();
    expect((await run(install, { restarter: false })).installing).toBeNull();
  });

  test('refuses an install before an update is ready', () =>
    run((updates) =>
      Effect.gen(function* () {
        yield* updates.report({ ...READY, update: { status: 'current' } });
        const failure = yield* Effect.flip(updates.request({ kind: 'install' }));
        expect(failure).toBeInstanceOf(DomainError);
        expect(failure.code).toBe('update_not_ready');
      })
    ));

  test('refuses requests while the app is not running, and for an engine no app carries', async () => {
    const stale = await run((updates) =>
      Effect.gen(function* () {
        yield* updates.report(READY);
        yield* TestClock.adjust('16 seconds');
        return yield* Effect.flip(updates.request({ kind: 'check' }));
      })
    );
    expect(stale.code).toBe('app_not_running');
    const missing = await run((updates) => Effect.flip(updates.request({ kind: 'check' })), { app: null });
    expect(missing.code).toBe('app_missing');
  });

  test('opens the app that carries the engine in the background', async () => {
    const opened = await run((updates, harness) =>
      Effect.gen(function* () {
        expect((yield* updates.open).running).toBe(false);
        return harness.opened;
      })
    );
    expect(opened).toEqual([APP]);
    const failed = await run((updates) => Effect.flip(updates.open), { openFails: true });
    expect(failed).toMatchObject({ code: 'app_open_failed', message: 'LSOpenURLsWithRole() failed' });
    const missing = await run((updates) => Effect.flip(updates.open), { app: null });
    expect(missing.code).toBe('app_missing');
  });
});
