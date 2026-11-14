import { describe, expect, test } from 'bun:test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import {
  applyPreviewAppRequest,
  createPreviewAppState,
  createPreviewAppUpdates,
  resolvePreviewRelaunch,
  runPreviewApp,
} from './app-updates.ts';
import { PREVIEW_APPS } from './schema.ts';

const STUDIO = PREVIEW_APPS.studio!;

const LAPTOP = PREVIEW_APPS.laptop!;

describe('the sandbox’s Shinsa for Mac', () => {
  test('Studio starts with an update ready and Laptop up to date', () => {
    expect(createPreviewAppState(STUDIO).report.update).toEqual({ status: 'ready', version: '1.5.0-beta.1' });
    expect(createPreviewAppState(LAPTOP).report.update).toEqual({ status: 'current' });
  });

  test('it checks, switches channel and answers the go-back offer', () => {
    const state = createPreviewAppState(LAPTOP);
    expect(applyPreviewAppRequest(LAPTOP, state, { kind: 'check' }).report.update).toEqual({
      status: 'current',
    });
    expect(applyPreviewAppRequest(LAPTOP, state, { kind: 'channel', channel: 'beta' }).report.channel).toBe(
      'beta'
    );
    const offered = {
      ...state,
      report: { ...state.report, update: { status: 'downgrade', version: '1.3.0' } as const },
    };
    expect(
      applyPreviewAppRequest(LAPTOP, offered, { kind: 'downgrade', accept: false }).report.update
    ).toEqual({
      status: 'current',
    });
    expect(applyPreviewAppRequest(LAPTOP, state, { kind: 'install' })).toBe(state);
  });

  test('installing goes quiet for two reports, then comes back on the new version', () => {
    const installing = applyPreviewAppRequest(STUDIO, createPreviewAppState(STUDIO), { kind: 'install' });
    expect(installing.report.update).toEqual({ status: 'installing', version: '1.5.0-beta.1' });
    const waiting = resolvePreviewRelaunch(installing);
    expect(waiting.quiet).toBe(1);
    expect(resolvePreviewRelaunch(waiting).report).toMatchObject({
      version: '1.5.0-beta.1',
      update: { status: 'current' },
    });
  });

  test('it reports to the engine and carries out what the engine queued', async () => {
    const view = await Effect.runPromise(
      Effect.gen(function* () {
        const appUpdates = yield* createPreviewAppUpdates(STUDIO);
        const fiber = yield* Effect.forkChild(runPreviewApp(appUpdates, STUDIO));
        yield* TestClock.adjust('1 second');
        yield* appUpdates.request({ kind: 'install' });
        yield* TestClock.adjust('5 seconds');
        const installing = yield* appUpdates.view;
        yield* TestClock.adjust('15 seconds');
        const relaunched = yield* appUpdates.open;
        yield* Fiber.interrupt(fiber);
        return { installing, relaunched };
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(view.installing.app?.update).toEqual({ status: 'installing', version: '1.5.0-beta.1' });
    expect(view.relaunched.app).toMatchObject({ version: '1.5.0-beta.1', update: { status: 'current' } });
  });

  test('a machine without the app has no one reporting', async () => {
    const view = await Effect.runPromise(
      Effect.gen(function* () {
        const appUpdates = yield* createPreviewAppUpdates(undefined);
        return yield* appUpdates.view;
      })
    );
    expect(view.source).toBe('standalone');
  });
});
