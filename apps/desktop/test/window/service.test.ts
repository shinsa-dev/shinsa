import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { CHANNELS } from '../../src/bridge/schema.ts';
import { describeEngineScreen } from '../../src/engine/screen.ts';
import type { NativeWindowEvent, WindowGuards } from '../../src/window/schema.ts';
import { AppWindow } from '../../src/window/service.ts';
import {
  closeWindow,
  CONTENTS_ID,
  createWorld,
  type DesktopWorld,
  flush,
  offer,
  runDesktop,
  USER_DATA,
} from '../support/desktop.ts';

const ORIGIN = 'http://127.0.0.1:7446';

const STARTING = describeEngineScreen({ kind: 'starting' });

function run<A>(
  world: DesktopWorld,
  body: (window: AppWindow['Service'], guards: WindowGuards) => Effect.Effect<A>
) {
  return runDesktop(
    world,
    AppWindow.use((window) =>
      Effect.gen(function* () {
        yield* flush;
        world.window.length = 0;
        if (!world.windowGuards) return yield* Effect.die('no guards');
        const result = yield* body(window, world.windowGuards);
        yield* flush;
        return result;
      })
    )
  );
}

function emit(world: DesktopWorld, event: NativeWindowEvent) {
  return offer(world.windowEvents, event);
}

describe('the window', () => {
  it('keeps a path until the server page loads, then sends paths to it', async () => {
    const world = createWorld();
    const pages = await run(world, (window) =>
      Effect.gen(function* () {
        yield* window.open('/tasks/LOC-4');
        const before = yield* window.page;
        const loaded = yield* window.showServerPage;
        yield* window.open('/settings');
        return [before, loaded, yield* window.page];
      })
    );
    expect(pages).toEqual(['none', true, 'app']);
    expect(world.window).toEqual([`load ${ORIGIN}/tasks/LOC-4`]);
    expect(world.sent).toEqual([[CHANNELS.navigate, '/settings']]);
  });

  it('loads a page afresh when it shows Shinsa, and keeps it for later on the status page', async () => {
    const world = createWorld();
    await run(world, (window) =>
      Effect.gen(function* () {
        yield* window.load('/?sign_in_error=sign_in_failed');
        yield* window.showServerPage;
        yield* window.load('/');
      })
    );
    expect(world.window).toEqual([`load ${ORIGIN}/?sign_in_error=sign_in_failed`, `load ${ORIGIN}/`]);
  });

  it('shows the waiting page and takes its actions', async () => {
    const world = createWorld({ loads: false });
    const answers = await run(world, (window, guards) =>
      Effect.gen(function* () {
        const loaded = yield* window.showWaiting(STARTING);
        const restart = yield* guards.navigate('shinsa://engine/restart');
        const page = yield* guards.navigate(`${ORIGIN}/tasks`);
        return [loaded, restart, page, yield* window.page];
      })
    );
    expect(answers).toEqual([false, false, false, 'waiting']);
    expect(world.window).toEqual([`waiting ${STARTING.title}`]);
    expect(world.actions).toEqual(['restart']);
  });

  it('keeps app links in the window, opens the web outside it and blocks the rest', async () => {
    const world = createWorld();
    const answers = await run(world, (window, guards) =>
      Effect.gen(function* () {
        yield* window.showServerPage;
        return [
          yield* guards.navigate(`${ORIGIN}/tasks`),
          yield* guards.navigate('https://shinsa.dev/docs'),
          yield* guards.navigate('file:///etc/passwd'),
          yield* guards.navigate('shinsa://task/LOC-4'),
        ];
      })
    );
    expect(answers).toEqual([true, false, false, false]);
    expect(world.shell).toEqual(['open https://shinsa.dev/docs']);
    expect(world.sent).toEqual([[CHANNELS.navigate, '/tasks/LOC-4']]);
  });

  it('follows a new window the page opens instead of opening one', async () => {
    const world = createWorld();
    await run(world, (window, guards) =>
      Effect.gen(function* () {
        yield* window.showServerPage;
        yield* guards.openWindow(`${ORIGIN}/settings`);
        yield* guards.openWindow('https://github.com/shinsa');
      })
    );
    expect(world.sent).toEqual([[CHANNELS.navigate, '/settings']]);
    expect(world.shell).toEqual(['open https://github.com/shinsa']);
  });

  it('hides on close and closes once the app quits, deciding synchronously as Electron asks', async () => {
    const world = createWorld();
    const answers = await run(world, (window) =>
      Effect.gen(function* () {
        const hidden = closeWindow(world);
        yield* window.markQuitting;
        return [hidden, closeWindow(world)];
      })
    );
    expect(answers).toEqual([false, true]);
    expect(world.window).toEqual(['hide']);
    expect(world.files.has(`${USER_DATA}/prefs.json`)).toBe(false);
  });

  it('saves its bounds once you finish moving or resizing it', async () => {
    const world = createWorld();
    await run(world, () => emit(world, { _tag: 'BoundsChanged' }));
    expect(JSON.parse(world.files.get(`${USER_DATA}/prefs.json`) ?? '{}')).toMatchObject({
      windowBounds: world.bounds,
    });
  });

  it('leaves full screen before it hides, and tells the page each change', async () => {
    const world = createWorld({ fullScreen: true });
    const states = await run(world, (window) =>
      Effect.gen(function* () {
        const full = yield* window.windowState;
        const closed = closeWindow(world);
        world.fullScreen = false;
        yield* emit(world, { _tag: 'FullScreen', on: false });
        yield* emit(world, { _tag: 'FullScreen', on: true });
        yield* emit(world, { _tag: 'FullScreen', on: false });
        return [full, closed, yield* window.windowState];
      })
    );
    expect(states).toEqual(['fullscreen', false, 'window']);
    expect(world.window).toEqual(['leave-full-screen', 'hide']);
    expect(world.sent).toEqual([
      [CHANNELS.windowState, 'window'],
      [CHANNELS.windowState, 'fullscreen'],
      [CHANNELS.windowState, 'window'],
    ]);
  });

  it('connects again when the server page fails to load, but not for a frame or a stop', async () => {
    const world = createWorld();
    const page = await run(world, (window) =>
      Effect.gen(function* () {
        yield* emit(world, { _tag: 'LoadFailed', code: -2, mainFrame: true });
        yield* window.showServerPage;
        yield* emit(world, { _tag: 'LoadFailed', code: -2, mainFrame: false });
        yield* emit(world, { _tag: 'LoadFailed', code: -3, mainFrame: true });
        const kept = yield* window.page;
        yield* emit(world, { _tag: 'LoadFailed', code: -2, mainFrame: true });
        return [kept, yield* window.page];
      })
    );
    expect(page).toEqual(['app', 'none']);
    expect(world.actions).toEqual(['retry']);
  });

  it('reloads the server page, and connects again when it is not shown', async () => {
    const world = createWorld();
    await run(world, (window) =>
      Effect.gen(function* () {
        yield* window.reload;
        yield* window.showServerPage;
        yield* emit(world, { _tag: 'RendererGone' });
      })
    );
    expect(world.actions).toEqual(['retry']);
    expect(world.window).toEqual([`load ${ORIGIN}/`, 'reload']);
  });

  it('steps back and forward only within the app', async () => {
    const world = createWorld({
      history: { urls: [`${ORIGIN}/`, `${ORIGIN}/tasks`, 'https://shinsa.dev/'], active: 1 },
    });
    await run(world, (window) =>
      Effect.gen(function* () {
        yield* window.step(-1);
        yield* window.showServerPage;
        yield* window.step(1);
        yield* window.step(-1);
      })
    );
    expect(world.window).toEqual([`load ${ORIGIN}/`, 'go 0']);
  });

  it('shows, sends to the page and knows its own top frame', async () => {
    const world = createWorld();
    const senders = await run(world, (window) =>
      Effect.gen(function* () {
        yield* window.show;
        yield* window.sendToPage(CHANNELS.notifyFailed);
        return [
          window.isAppSender({ contentsId: CONTENTS_ID, url: `${ORIGIN}/tasks`, top: true }),
          window.isAppSender({ contentsId: CONTENTS_ID, url: `${ORIGIN}/tasks`, top: false }),
          window.isAppSender({ contentsId: CONTENTS_ID, url: 'https://evil.example/', top: true }),
          window.isAppSender({ contentsId: CONTENTS_ID, url: null, top: true }),
          window.isAppSender({ contentsId: 8, url: `${ORIGIN}/tasks`, top: true }),
          window.ownsSender({ contentsId: CONTENTS_ID, url: null, top: false }),
          window.ownsSender({ contentsId: 8, url: null, top: true }),
        ];
      })
    );
    expect(senders).toEqual([true, false, false, false, false, true, false]);
    expect(world.window).toEqual(['show']);
    expect(world.sent).toEqual([[CHANNELS.notifyFailed, undefined]]);
  });
});
