import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { CHANNELS } from '../../src/bridge/schema.ts';
import { AppWindow } from '../../src/window/service.ts';
import { closeWindow, createWorld, type DesktopWorld, flush, offer, runDesktop } from '../support/desktop.ts';

function run(world: DesktopWorld, body: (window: AppWindow['Service']) => Effect.Effect<void>) {
  return runDesktop(
    world,
    AppWindow.use((window) =>
      Effect.gen(function* () {
        yield* flush;
        yield* body(window);
        yield* flush;
      })
    )
  );
}

describe('the app', () => {
  it('opens the link it was started with once the server page shows', async () => {
    const world = createWorld({
      argv: ['/Applications/Shinsa.app/Contents/MacOS/Shinsa', 'shinsa://task/LOC-4'],
    });
    await run(world, (window) => Effect.asVoid(window.showServerPage));
    expect(world.window).toEqual(['load http://127.0.0.1:7446/tasks/LOC-4']);
  });

  it('opens links from macOS and from a second launch, and shows the window', async () => {
    const world = createWorld();
    await run(world, (window) =>
      Effect.gen(function* () {
        yield* window.showServerPage;
        yield* offer(world.shellEvents, { _tag: 'OpenUrl', url: 'shinsa://settings' });
        yield* offer(world.shellEvents, { _tag: 'SecondInstance', argv: ['Shinsa', 'shinsa://task/LOC-9'] });
        yield* offer(world.shellEvents, { _tag: 'SecondInstance', argv: ['Shinsa'] });
        yield* offer(world.shellEvents, { _tag: 'Activate' });
      })
    );
    expect(world.sent).toEqual([
      [CHANNELS.navigate, '/settings'],
      [CHANNELS.navigate, '/tasks/LOC-9'],
    ]);
    expect(world.window.filter((call) => call === 'show')).toHaveLength(4);
  });

  it('lets the window close once the app quits', async () => {
    const world = createWorld();
    await run(world, () => Effect.suspend(() => world.shellGuards?.beforeQuit ?? Effect.void));
    expect(closeWindow(world)).toBe(true);
  });

  it('finishes a sign-in from its link instead of opening it as a page', async () => {
    const world = createWorld({
      argv: ['/Applications/Shinsa.app/Contents/MacOS/Shinsa', 'shinsa://signed-in?code=late'],
    });
    await run(world, (window) =>
      Effect.gen(function* () {
        yield* window.showServerPage;
        yield* offer(world.shellEvents, { _tag: 'OpenUrl', url: 'shinsa://signed-in?error=sign_in_failed' });
      })
    );
    expect(world.sent).toEqual([]);
    expect(world.window).toEqual([
      'show',
      'load http://127.0.0.1:7446/?sign_in_error=sign_in_expired',
      'load http://127.0.0.1:7446/?sign_in_error=sign_in_failed',
      'show',
    ]);
  });
});
