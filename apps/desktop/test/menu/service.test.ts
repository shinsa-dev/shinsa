import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { CHANNELS } from '../../src/bridge/schema.ts';
import type { MenuSection } from '../../src/menu/schema.ts';
import { AppMenu } from '../../src/menu/service.ts';
import { AppWindow } from '../../src/window/service.ts';
import { createWorld, type DesktopWorld, flush, offer, runDesktop } from '../support/desktop.ts';

function run(
  world: DesktopWorld,
  body: (menu: AppMenu['Service'], window: AppWindow['Service']) => Effect.Effect<void>
) {
  return runDesktop(
    world,
    Effect.gen(function* () {
      const menu = yield* AppMenu;
      const window = yield* AppWindow;
      yield* flush;
      yield* body(menu, window);
      yield* flush;
    })
  );
}

function listLabels(sections: readonly MenuSection[]) {
  return sections.map((section) => [
    section.label,
    section.entries.map((entry) =>
      entry.kind === 'separator' ? '-' : entry.kind === 'role' ? entry.role : entry.label
    ),
  ]);
}

describe('the app menu', () => {
  it('lays out the menus with the update item for the current state', async () => {
    const world = createWorld({ platform: 'linux' });
    await run(world, () => Effect.void);
    const sections = world.menus.at(-1) ?? [];
    expect(listLabels(sections)).toEqual([
      [
        'Shinsa',
        [
          'about',
          'Check for Updates…',
          '-',
          'Settings…',
          'Restart Engine',
          '-',
          'services',
          '-',
          'hide',
          'hideOthers',
          'unhide',
          '-',
          'quit',
        ],
      ],
      ['Edit', ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']],
      ['View', ['Reload']],
      ['Go', ['Back', 'Forward', '-', 'Home']],
      ['Window', ['minimize', 'zoom', '-', 'Shinsa', '-', 'front']],
    ]);
    expect(sections[0]?.entries[1]).toMatchObject({ enabled: true, visible: false });
    expect(sections[4]?.role).toBe('window');
    expect(world.about.at(-1)).toEqual({
      applicationName: 'Shinsa',
      applicationVersion: '1.2.0, Stable channel',
    });
  });

  it('offers the developer tools only in the unpackaged app', async () => {
    const world = createWorld({ packaged: false });
    await run(world, () => Effect.void);
    const view = (world.menus.at(-1) ?? []).find((section) => section.label === 'View');
    expect(listLabels(view ? [view] : [])).toEqual([
      ['View', ['Reload', '-', 'toggleDevTools']],
    ]);
  });

  it('names the server in the About panel', async () => {
    const world = createWorld();
    await run(world, (menu) => menu.showServer({ version: '1.2.0', working: 0, updating: false }));
    expect(world.about.at(-1)).toEqual({
      applicationName: 'Shinsa',
      applicationVersion: '1.2.0, Stable channel',
      credits: 'Shinsa 1.2.0 at http://127.0.0.1:7446',
    });
  });

  it('carries out each menu command', async () => {
    const world = createWorld({ history: { urls: ['http://127.0.0.1:7446/'], active: 1 } });
    await run(world, (_menu, window) =>
      Effect.gen(function* () {
        yield* offer(world.menuCommands, { _tag: 'Reload' });
        yield* window.showServerPage;
        yield* offer(world.menuCommands, { _tag: 'Open', path: '/settings' });
        yield* offer(world.menuCommands, { _tag: 'Show' });
        yield* offer(world.menuCommands, { _tag: 'Step', offset: -1 });
        yield* offer(world.menuCommands, { _tag: 'RestartEngine' });
        yield* offer(world.menuCommands, { _tag: 'Update', install: false });
        yield* offer(world.menuCommands, { _tag: 'Update', install: true });
      })
    );
    expect(world.sent).toContainEqual([CHANNELS.navigate, '/settings']);
    expect(world.window.slice(-4)).toEqual(['load http://127.0.0.1:7446/', 'show', 'show', 'go 0']);
    expect(world.actions).toEqual(['retry', 'restart']);
    expect(world.checks).toBe(1);
  });

  it('carries out menu commands while an update check waits on the network', async () => {
    const world = createWorld({ onCheck: () => ({ hang: true }) });
    await run(world, () =>
      Effect.gen(function* () {
        yield* offer(world.menuCommands, { _tag: 'Update', install: false });
        yield* offer(world.menuCommands, { _tag: 'RestartEngine' });
      })
    );
    expect(world.checks).toBe(1);
    expect(world.actions).toEqual(['restart']);
  });
});
