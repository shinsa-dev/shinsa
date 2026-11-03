import { describe, expect, it } from 'bun:test';
import { Effect, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import type { UpdateEvent } from '../../src/updates/schema.ts';
import { Updater } from '../../src/updates/service.ts';
import {
  type CheckScript,
  closeWindow,
  createWorld,
  type DesktopWorld,
  emitUpdate,
  flush,
  LOGS,
  runDesktop,
  USER_DATA,
} from '../support/desktop.ts';

const LOG = `${LOGS}/updater.log`;

const PREFS = `${USER_DATA}/prefs.json`;

const STABLE = { channel: 'latest', allowPrerelease: false, allowDowngrade: false };

const FOUND: CheckScript = {
  events: [
    { _tag: 'Available', version: '1.3.0' },
    { _tag: 'Progress', percent: 42.7 },
  ],
  download: true,
};

function run<A>(world: DesktopWorld, body: (updater: Updater['Service']) => Effect.Effect<A>) {
  return runDesktop(
    world,
    Updater.use((updater) =>
      Effect.gen(function* () {
        yield* updater.start;
        yield* flush;
        const result = yield* body(updater);
        yield* flush;
        return result;
      })
    )
  );
}

function emit(world: DesktopWorld, ...events: UpdateEvent[]) {
  return Effect.andThen(
    Effect.forEach(events, (event) => emitUpdate(world, event)),
    flush
  );
}

const readState = (updater: Updater['Service']) => Effect.map(updater.snapshot, (snapshot) => snapshot.state);

function listLog(world: DesktopWorld) {
  return (world.files.get(LOG) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/^\S+ /, ''));
}

describe('the updater', () => {
  it('does nothing in a development run, but still keeps the channel you pick', async () => {
    const world = createWorld({ packaged: false });
    const snapshot = await run(world, (updater) =>
      Effect.gen(function* () {
        yield* updater.check(true);
        yield* updater.applyChannel('beta');
        yield* updater.install;
        return yield* updater.snapshot;
      })
    );
    expect(snapshot).toEqual({ state: { status: 'idle' }, channel: 'beta', supported: false });
    expect(world.checks).toBe(0);
    expect(world.configured).toEqual([]);
    expect(world.files.has(LOG)).toBe(false);
    expect(JSON.parse(world.files.get(PREFS) ?? '')).toEqual({ updateChannel: 'beta', keptVersion: null });
  });

  it('starts on its own version’s channel, or the one you chose, and ignores one it does not offer', async () => {
    const beta = createWorld({ version: '1.3.0-beta.2', packaged: false });
    expect((await run(beta, (updater) => updater.snapshot)).channel).toBe('beta');
    const chosen = createWorld({ packaged: false });
    chosen.files.set(PREFS, JSON.stringify({ updateChannel: 'canary' }));
    expect((await run(chosen, (updater) => updater.snapshot)).channel).toBe('canary');
    const unknown = createWorld({ packaged: false });
    unknown.files.set(PREFS, JSON.stringify({ updateChannel: 'nightly' }));
    expect((await run(unknown, (updater) => updater.snapshot)).channel).toBe('stable');
  });

  it('logs its start, sets the feed up for the channel, checks at once and every four hours', async () => {
    const world = createWorld({ onCheck: () => ({ events: [{ _tag: 'NotAvailable', version: '1.2.0' }] }) });
    world.files.set(LOG, 'x'.repeat(1_000_001));
    await run(world, () =>
      Effect.gen(function* () {
        yield* TestClock.adjust('3 hours');
        expect(world.checks).toBe(1);
        yield* TestClock.adjust('1 hour');
        yield* flush;
        expect(world.checks).toBe(2);
      })
    );
    expect(world.files.has(`${LOGS}/updater.old.log`)).toBe(true);
    expect(world.configured).toEqual([STABLE]);
    expect(listLog(world)).toEqual([
      'info Shinsa 1.2.0 on the stable channel',
      'info state idle -> checking',
      'info state checking -> current',
      'info state current -> checking',
      'info state checking -> current',
    ]);
    expect(world.dialogs).toEqual([]);
  });

  it('downloads what it finds, prepares it and offers the restart once Squirrel has staged it', async () => {
    const world = createWorld({ onCheck: () => FOUND });
    const states = await run(world, (updater) =>
      Effect.gen(function* () {
        const downloading = yield* readState(updater);
        yield* emit(world, { _tag: 'Downloaded', version: '1.3.0' });
        const preparing = yield* readState(updater);
        yield* emit(world, { _tag: 'Staged' }, { _tag: 'Staged' });
        return [downloading, preparing, yield* readState(updater)];
      })
    );
    expect(states).toEqual([
      { status: 'downloading', version: '1.3.0', percent: 42.7 },
      { status: 'preparing', version: '1.3.0' },
      { status: 'ready', version: '1.3.0' },
    ]);
    expect(world.notices).toEqual([
      {
        title: 'Shinsa 1.3.0 is ready',
        body: 'It installs the next time you quit Shinsa, or restart now from the Shinsa menu. Agents keep working either way.',
        tag: 'update',
        path: null,
      },
    ]);
    expect(listLog(world)).toContain('info Squirrel: update staged');
  });

  it('ignores progress when nothing downloads, and a check while an update is on its way', async () => {
    const world = createWorld({ onCheck: () => FOUND });
    const state = await run(world, (updater) =>
      Effect.gen(function* () {
        yield* updater.check(true);
        yield* emit(world, { _tag: 'Downloaded', version: '1.3.0' }, { _tag: 'Progress', percent: 90 });
        return yield* readState(updater);
      })
    );
    expect(state).toEqual({ status: 'preparing', version: '1.3.0' });
    expect(world.checks).toBe(1);
  });

  it('restarts to install, marks the window quitting, and offers the restart again if the app is still running after 15 s', async () => {
    const world = createWorld({ onCheck: () => FOUND });
    const states = await run(world, (updater) =>
      Effect.gen(function* () {
        yield* updater.install;
        expect(world.installs).toBe(0);
        yield* emit(world, { _tag: 'Downloaded', version: '1.3.0' }, { _tag: 'Staged' });
        const fiber = yield* Effect.forkChild(updater.install);
        yield* Fiber.join(fiber);
        yield* emit(world, { _tag: 'QuittingToInstall' });
        const installing = yield* readState(updater);
        yield* TestClock.adjust('15 seconds');
        yield* flush;
        return [installing, yield* readState(updater)];
      })
    );
    expect(world.installs).toBe(1);
    expect(await closeWindow(world)).toBe(true);
    expect(states).toEqual([
      { status: 'installing', version: '1.3.0' },
      { status: 'ready', version: '1.3.0' },
    ]);
    expect(world.notices.at(-1)).toEqual({
      title: 'Shinsa 1.3.0 did not restart',
      body: 'Quit Shinsa to install it. Agents keep working either way.',
      tag: 'update',
      path: null,
    });
    expect(listLog(world)).toContain('info Squirrel: quitting to install');
  });

  it('leaves the timeout alone once the update failed', async () => {
    const world = createWorld({ onCheck: () => FOUND });
    const state = await run(world, (updater) =>
      Effect.gen(function* () {
        yield* emit(world, { _tag: 'Downloaded', version: '1.3.0' }, { _tag: 'Staged' });
        yield* updater.install;
        yield* emit(world, { _tag: 'Failed', message: 'App Still Running Error' });
        yield* TestClock.adjust('15 seconds');
        return yield* readState(updater);
      })
    );
    expect(state).toEqual({ status: 'failed', message: 'App Still Running Error' });
    expect(world.notices.at(-1)).toEqual({
      title: 'Shinsa 1.3.0 could not be installed',
      body: 'App Still Running Error',
      tag: 'update',
      path: null,
    });
  });

  it('answers a check you asked for in a dialog, and a background one only in the menu', async () => {
    const world = createWorld({ onCheck: () => ({ events: [{ _tag: 'NotAvailable', version: '1.2.0' }] }) });
    await run(world, (updater) => updater.check(true));
    expect(world.dialogs).toEqual([
      {
        type: 'info',
        message: 'Shinsa is up to date',
        detail: 'You have Shinsa 1.2.0, the latest version on the Stable channel.',
      },
    ]);
  });

  it('shows why a check you asked for failed, and keeps a background failure in the menu', async () => {
    const world = createWorld({ onCheck: () => ({ fail: 'HttpError: 404' }) });
    const state = await run(world, (updater) => Effect.andThen(updater.check(true), readState(updater)));
    expect(state).toEqual({ status: 'failed', message: 'HttpError: 404' });
    expect(world.dialogs).toEqual([
      { type: 'warning', message: 'Shinsa could not check for updates', detail: 'HttpError: 404' },
    ]);
    expect(world.notices).toEqual([]);
  });

  it('settles a failure electron-updater reports during a check without a notice', async () => {
    const world = createWorld({ onCheck: () => ({ events: [{ _tag: 'Failed', message: 'offline' }] }) });
    const state = await run(world, readState);
    expect(state).toEqual({ status: 'failed', message: 'offline' });
    expect(world.notices).toEqual([]);
  });

  it('writes electron-updater’s own lines to the log', async () => {
    const world = createWorld();
    await run(world, () => emit(world, { _tag: 'Log', level: 'warn', message: 'slow mirror' }));
    expect(listLog(world)).toContain('warn slow mirror');
  });

  it('offers a beta on Stable the way back to the latest stable, and asks when you check', async () => {
    const world = createWorld({
      version: '1.3.0-beta.1',
      onCheck: () => ({ events: [{ _tag: 'NotAvailable', version: '1.2.0' }] }),
    });
    world.files.set(PREFS, JSON.stringify({ updateChannel: 'stable' }));
    const state = await run(world, (updater) =>
      Effect.gen(function* () {
        const background = yield* readState(updater);
        expect(world.dialogs).toEqual([]);
        yield* updater.check(true);
        yield* flush;
        return [background, yield* readState(updater)];
      })
    );
    expect(state[0]).toEqual({ status: 'downgrade', version: '1.2.0' });
    expect(world.dialogs.map((dialog) => [dialog.type, dialog.message])).toEqual([
      ['question', 'Go back to 1.2.0 (stable)?'],
    ]);
    expect(state[1]).toEqual({ status: 'current', latest: '1.2.0' });
    expect(JSON.parse(world.files.get(PREFS) ?? '').keptVersion).toBe('1.3.0-beta.1');
  });

  it('downloads the version you go back to with downgrades allowed for that check only', async () => {
    let checks = 0;
    const world = createWorld({
      version: '1.3.0-beta.1',
      dialogAnswer: () => 0,
      onCheck: () => {
        checks += 1;
        return checks === 1 ? { events: [{ _tag: 'NotAvailable', version: '1.2.0' }] } : FOUND;
      },
    });
    world.files.set(PREFS, JSON.stringify({ updateChannel: 'stable', keptVersion: '1.1.0' }));
    const state = await run(world, (updater) =>
      Effect.andThen(updater.answerDowngrade(true), readState(updater))
    );
    expect(state).toEqual({ status: 'downloading', version: '1.3.0', percent: 42.7 });
    expect(world.configured).toEqual([STABLE, { ...STABLE, allowDowngrade: true }, STABLE]);
    expect(JSON.parse(world.files.get(PREFS) ?? '').keptVersion).toBeNull();
  });

  it('does not offer the way back again once you chose to stay, until you check yourself', async () => {
    const world = createWorld({
      version: '1.3.0-beta.1',
      onCheck: () => ({ events: [{ _tag: 'NotAvailable', version: '1.2.0' }] }),
    });
    world.files.set(PREFS, JSON.stringify({ updateChannel: 'stable', keptVersion: '1.3.0-beta.1' }));
    const state = await run(world, (updater) =>
      Effect.gen(function* () {
        yield* updater.answerDowngrade(false);
        return yield* readState(updater);
      })
    );
    expect(state).toEqual({ status: 'current', latest: '1.2.0' });
  });

  it('switches channel: saves it, discards a download above it, checks again and asks about the way back', async () => {
    const world = createWorld({
      version: '1.3.0-beta.1',
      onCheck: () =>
        world.checks === 1
          ? { events: [{ _tag: 'Available', version: '1.4.0-beta.1' }], download: true }
          : { events: [{ _tag: 'NotAvailable', version: '1.2.0' }] },
    });
    const state = await run(world, (updater) =>
      Effect.gen(function* () {
        yield* updater.applyChannel('beta');
        yield* updater.applyChannel('stable');
        yield* flush;
        return yield* readState(updater);
      })
    );
    expect(world.downloads).toEqual(['cancel', 'done']);
    expect(world.launchctl).toEqual([['remove', 'studio.overclock.shinsa.ShipIt']]);
    expect(world.configured.at(-1)).toEqual(STABLE);
    expect(world.dialogs.map((dialog) => dialog.message)).toEqual(['Go back to 1.2.0 (stable)?']);
    expect(state).toEqual({ status: 'current', latest: '1.2.0' });
    expect(JSON.parse(world.files.get(PREFS) ?? '')).toEqual({
      updateChannel: 'stable',
      keptVersion: '1.3.0-beta.1',
    });
  });

  it('removes Squirrel’s staged copy when the switch comes after the download finished', async () => {
    const world = createWorld({
      version: '1.3.0-beta.1',
      onCheck: () =>
        world.checks === 1
          ? { events: [{ _tag: 'Available', version: '1.4.0-beta.1' }], download: true }
          : {},
    });
    world.files.set('/Users/me/Library/Caches/studio.overclock.shinsa.ShipIt', 'staged');
    await run(world, (updater) =>
      Effect.gen(function* () {
        yield* emit(world, { _tag: 'Downloaded', version: '1.4.0-beta.1' });
        yield* updater.applyChannel('stable');
      })
    );
    expect(world.downloads).toEqual([]);
    expect(world.files.has('/Users/me/Library/Caches/studio.overclock.shinsa.ShipIt')).toBe(false);
  });

  it('reports the state and each change on its stream', async () => {
    const world = createWorld({ onCheck: () => ({ events: [{ _tag: 'NotAvailable', version: '1.2.0' }] }) });
    const statuses = await runDesktop(
      world,
      Updater.use((updater) =>
        Effect.gen(function* () {
          const seen = yield* Effect.forkChild(Stream.runCollect(Stream.take(updater.changes, 3)), {
            startImmediately: true,
          });
          yield* updater.start;
          return (yield* Fiber.join(seen)).map((snapshot) => snapshot.state.status);
        })
      )
    );
    expect(statuses).toEqual(['idle', 'checking', 'current']);
  });
});
