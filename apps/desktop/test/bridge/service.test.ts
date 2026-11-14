import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { CHANNELS } from '../../src/bridge/schema.ts';
import { StatusTray } from '../../src/tray/service.ts';
import { Updater } from '../../src/updates/service.ts';
import type { SenderFrame } from '../../src/window/schema.ts';
import {
  CONTENTS_ID,
  createWorld,
  type DesktopWorld,
  flush,
  offer,
  runDesktop,
  USER_DATA,
} from '../support/desktop.ts';

const APP: SenderFrame = { contentsId: CONTENTS_ID, url: 'http://127.0.0.1:7446/tasks', top: true };

const PREFS = `${USER_DATA}/prefs.json`;

const FRAME: SenderFrame = { ...APP, top: false };

function run<A>(world: DesktopWorld, body: (updater: Updater['Service']) => Effect.Effect<A>) {
  return runDesktop(
    world,
    Updater.use((updater) =>
      Effect.gen(function* () {
        yield* flush;
        const result = yield* body(updater);
        yield* flush;
        return result;
      })
    )
  );
}

function send(world: DesktopWorld, channel: string, payload?: unknown, frame = APP) {
  return offer(world.pageMessages, { frame, channel, payload });
}

function start(world: DesktopWorld, frame: SenderFrame) {
  return Effect.suspend(() => world.start?.(frame) ?? Effect.succeed(null));
}

describe('the page bridge', () => {
  it('answers the start only to its own window', async () => {
    const world = createWorld({ fullScreen: true });
    const answers = await run(world, () =>
      Effect.all([start(world, FRAME), start(world, { ...APP, contentsId: 9 })])
    );
    expect(answers).toEqual([
      {
        version: '1.2.0',
        protocol: 1,
        update: { status: 'none' },
        channel: 'stable',
        windowState: 'fullscreen',
        source: { kind: 'local' },
      },
      null,
    ]);
  });

  it('sets the badge, shows notifications and opens notification settings for the page', async () => {
    const world = createWorld();
    await run(world, () =>
      Effect.gen(function* () {
        yield* send(world, CHANNELS.badge, 3);
        yield* send(world, CHANNELS.badge, 'many');
        yield* send(world, CHANNELS.notify, {
          title: ' Needs you ',
          body: 'Review LOC-4',
          tag: 'LOC-4',
          path: '/tasks/LOC-4',
        });
        yield* send(world, CHANNELS.notify, { title: '', body: 'nothing', tag: 'x', path: null });
        yield* send(world, CHANNELS.notificationSettings);
      })
    );
    expect(world.shell).toEqual([
      'badge 3',
      'badge ',
      'open x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=studio.overclock.shinsa',
    ]);
    expect(world.notices).toEqual([
      { title: 'Needs you', body: 'Review LOC-4', tag: 'LOC-4', path: '/tasks/LOC-4' },
    ]);
  });

  it('puts the page’s count on the menu bar item while it views a machine on Shinsa Cloud', async () => {
    const world = createWorld({
      files: new Map([
        [PREFS, JSON.stringify({ engineSource: { kind: 'cloud', machine: { id: 'm1', name: 'Studio' } } })],
      ]),
    });
    await runDesktop(
      world,
      Effect.gen(function* () {
        const tray = yield* StatusTray;
        yield* flush;
        yield* tray.update({ version: null, working: 0, updating: false }, null);
        yield* send(world, CHANNELS.badge, 3, { ...APP, url: 'https://app.shinsa.dev/' });
        yield* flush;
      })
    );
    expect(world.shell).toEqual(['badge 3']);
    expect(world.tray.at(-1)?.title).toBe('3');
  });

  it('ignores a frame, another window and a message it does not know', async () => {
    const world = createWorld();
    await run(world, () =>
      Effect.gen(function* () {
        yield* send(world, CHANNELS.badge, 3, FRAME);
        yield* send(world, CHANNELS.badge, 3, { ...APP, contentsId: 9 });
        yield* send(world, CHANNELS.updateChannel, 'nightly');
        yield* send(world, 'shinsa:unknown');
      })
    );
    expect(world.shell).toEqual([]);
  });

  it('passes the page’s update requests to the updater', async () => {
    const world = createWorld({ platform: 'linux' });
    const snapshot = await run(world, (updater) =>
      Effect.gen(function* () {
        yield* send(world, CHANNELS.updateChannel, 'beta');
        yield* send(world, CHANNELS.checkForUpdates);
        yield* send(world, CHANNELS.installUpdate);
        yield* send(world, CHANNELS.downgrade, 'yes');
        return yield* updater.snapshot;
      })
    );
    expect(snapshot.channel).toBe('beta');
    expect(JSON.parse(world.files.get(`${USER_DATA}/prefs.json`) ?? '{}')).toMatchObject({
      updateChannel: 'beta',
    });
    expect(world.checks).toBe(0);
  });

  it('keeps answering the page while an update check waits on the network', async () => {
    const world = createWorld({ onCheck: () => ({ hang: true }) });
    await run(world, () =>
      Effect.gen(function* () {
        yield* send(world, CHANNELS.checkForUpdates);
        yield* send(world, CHANNELS.updateChannel, 'beta');
        yield* send(world, CHANNELS.downgrade, true);
        yield* send(world, CHANNELS.badge, 2);
        yield* send(world, CHANNELS.notify, {
          title: 'Done',
          body: 'LOC-4 merged',
          tag: 'LOC-4',
          path: null,
        });
      })
    );
    expect(world.checks).toBeGreaterThan(0);
    expect(world.shell).toEqual(['badge 2']);
    expect(world.notices).toEqual([{ title: 'Done', body: 'LOC-4 merged', tag: 'LOC-4', path: null }]);
  });

  it('sends each update state to the page', async () => {
    const world = createWorld({ onCheck: () => ({ events: [{ _tag: 'Available', version: '1.3.0' }] }) });
    await run(world, (updater) =>
      Effect.gen(function* () {
        yield* updater.start;
        yield* flush;
        yield* send(world, CHANNELS.downgrade, true);
      })
    );
    expect(world.sent).toContainEqual([
      CHANNELS.update,
      { status: 'downloading', version: '1.3.0', percent: 0 },
    ]);
  });

  it('signs in and switches the engine for the page, reloading when only the machine changes', async () => {
    const world = createWorld({
      files: new Map([[PREFS, JSON.stringify({ engineSource: { kind: 'cloud', machine: null } })]]),
    });
    const answers = await run(world, () =>
      Effect.gen(function* () {
        const cloudPage: SenderFrame = { ...APP, url: 'https://app.shinsa.dev/' };
        yield* send(world, CHANNELS.signIn, undefined, cloudPage);
        yield* send(world, CHANNELS.useMachine, { id: 'm1', name: 'Studio' }, cloudPage);
        const pinned = yield* start(world, cloudPage);
        yield* send(world, CHANNELS.useMachine, { id: '', name: 'Nameless' }, cloudPage);
        yield* send(world, CHANNELS.useLocalEngine, undefined, cloudPage);
        return pinned?.source;
      })
    );
    expect(answers).toEqual({ kind: 'cloud', machine: { id: 'm1', name: 'Studio' } });
    expect(world.shell[0]).toStartWith('open https://app.shinsa.dev/__remote/sign-in?client=native');
    expect(world.shell.slice(1)).toEqual(['relaunch']);
    expect(world.actions).toEqual(['retry']);
    expect(JSON.parse(world.files.get(PREFS) ?? '{}')).toMatchObject({ engineSource: { kind: 'local' } });
  });
});
