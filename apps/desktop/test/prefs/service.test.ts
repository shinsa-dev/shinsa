import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { Prefs } from '../../src/prefs/service.ts';
import { createWorld, runDesktop, USER_DATA } from '../support/desktop.ts';

const FILE = `${USER_DATA}/prefs.json`;

const BOUNDS = { x: 10, y: 20, width: 900, height: 1000 };

describe('the app’s preferences', () => {
  it('reads what was saved, and leaves out what it does not understand', async () => {
    const world = createWorld();
    world.files.set(
      FILE,
      JSON.stringify({ windowBounds: BOUNDS, updateChannel: 'nightly', keptVersion: '1.2.0', other: 1 })
    );
    expect(
      await runDesktop(
        world,
        Prefs.use((prefs) => prefs.read)
      )
    ).toEqual({
      windowBounds: BOUNDS,
      keptVersion: '1.2.0',
    });
  });

  it('drops a window too small to use and a kept version that is not one', async () => {
    const world = createWorld();
    world.files.set(
      FILE,
      JSON.stringify({ windowBounds: { ...BOUNDS, width: 10 }, updateChannel: 'beta', keptVersion: 3 })
    );
    expect(
      await runDesktop(
        world,
        Prefs.use((prefs) => prefs.read)
      )
    ).toEqual({ updateChannel: 'beta' });
  });

  it('starts empty without a file, or with one that is not JSON', async () => {
    expect(
      await runDesktop(
        createWorld(),
        Prefs.use((prefs) => prefs.read)
      )
    ).toEqual({});
    const broken = createWorld();
    broken.files.set(FILE, '{ not json');
    expect(
      await runDesktop(
        broken,
        Prefs.use((prefs) => prefs.read)
      )
    ).toEqual({});
  });

  it('merges each change into what it has and writes the file', async () => {
    const world = createWorld();
    world.files.set(FILE, JSON.stringify({ updateChannel: 'beta' }));
    const read = await runDesktop(
      world,
      Prefs.use((prefs) =>
        Effect.gen(function* () {
          yield* prefs.write({ windowBounds: BOUNDS });
          yield* prefs.write({ keptVersion: null });
          return yield* prefs.read;
        })
      )
    );
    expect(read).toEqual({ updateChannel: 'beta', windowBounds: BOUNDS, keptVersion: null });
    const written = world.files.get(FILE) ?? '';
    expect(JSON.parse(written)).toEqual(read);
    expect(written).toContain('\n  "updateChannel": "beta"');
  });

  it('keeps a change for this run when the file cannot be written', async () => {
    const world = createWorld({ unwritable: new Set([FILE]) });
    const read = await runDesktop(
      world,
      Prefs.use((prefs) => Effect.andThen(prefs.write({ updateChannel: 'canary' }), prefs.read))
    );
    expect(read).toEqual({ updateChannel: 'canary' });
    expect(world.files.has(FILE)).toBe(false);
  });
});
