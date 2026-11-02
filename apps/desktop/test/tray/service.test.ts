import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { CHANNELS } from '../../src/bridge/schema.ts';
import { StatusTray } from '../../src/tray/service.ts';
import { AppWindow } from '../../src/window/service.ts';
import { createWorld, type DesktopWorld, flush, offer, runDesktop } from '../support/desktop.ts';

const HEALTH = { version: '1.2.0', working: 2, updating: false };

const QUEUE = {
  decisions: [{ path: '/tasks/LOC-4', title: 'Fix the badge', detail: 'Review · LOC-4' }],
  working: [],
};

function run(
  world: DesktopWorld,
  body: (tray: StatusTray['Service'], window: AppWindow['Service']) => Effect.Effect<void>
) {
  return runDesktop(
    world,
    Effect.gen(function* () {
      const tray = yield* StatusTray;
      const window = yield* AppWindow;
      yield* flush;
      yield* body(tray, window);
      yield* flush;
    })
  );
}

describe('the menu bar item', () => {
  it('starts as not answering and shows each new state once', async () => {
    const world = createWorld();
    await run(world, (tray) =>
      Effect.gen(function* () {
        yield* tray.update(null, null);
        yield* tray.update(HEALTH, null);
        yield* tray.update(HEALTH, QUEUE);
        yield* tray.update(HEALTH, QUEUE);
      })
    );
    expect(world.tray.map((view) => [view.title, view.tooltip])).toEqual([
      ['', 'The engine is not answering'],
      ['', 'The engine is running. 2 agents are working'],
      ['1', 'The engine is running'],
    ]);
  });

  it('opens a task, opens Shinsa and quits from its menu', async () => {
    const world = createWorld();
    await run(world, (_tray, window) =>
      Effect.gen(function* () {
        yield* window.showServerPage;
        yield* offer(world.trayClicks, { kind: 'task', path: '/tasks/LOC-4' });
        yield* offer(world.trayClicks, { kind: 'action', action: 'open' });
        yield* offer(world.trayClicks, { kind: 'action', action: 'quit' });
      })
    );
    expect(world.sent).toEqual([[CHANNELS.navigate, '/tasks/LOC-4']]);
    expect(world.window.filter((call) => call === 'show')).toHaveLength(2);
    expect(world.shell).toEqual(['quit']);
  });
});
