import { describe, expect, it } from 'bun:test';
import { Effect, Fiber } from 'effect';
import { EngineSource } from '../../src/source/service.ts';
import { createWorld, runDesktop, USER_DATA } from '../support/desktop.ts';

const FILE = `${USER_DATA}/prefs.json`;

describe('the engine source', () => {
  it('starts on This Mac when nothing was saved, or the saved one is not understood', async () => {
    const world = createWorld();
    world.files.set(FILE, JSON.stringify({ engineSource: { kind: 'cloud', machine: { id: '' } } }));
    expect(
      await runDesktop(
        world,
        EngineSource.use((source) => Effect.succeed(source.started))
      )
    ).toEqual({
      kind: 'local',
    });
  });

  it('saves a switch, relaunching only to move between This Mac and Shinsa Cloud', async () => {
    const world = createWorld();
    const steps = await runDesktop(
      world,
      Effect.gen(function* () {
        const source = yield* EngineSource;
        return [
          yield* source.use({ kind: 'local' }),
          yield* source.use({ kind: 'cloud', machine: null }),
          yield* source.use({ kind: 'cloud', machine: { id: 'm1', name: 'Studio' } }),
          source.started,
          yield* source.current,
        ];
      })
    );
    expect(steps).toEqual([
      'none',
      'relaunch',
      'reload',
      { kind: 'local' },
      { kind: 'cloud', machine: { id: 'm1', name: 'Studio' } },
    ]);
    expect(world.shell).toEqual(['relaunch']);
    expect(JSON.parse(world.files.get(FILE) ?? '{}')).toEqual({
      engineSource: { kind: 'cloud', machine: { id: 'm1', name: 'Studio' } },
    });
  });

  it('saves the first choice even when it keeps This Mac, and lets the welcome page go on', async () => {
    const world = createWorld();
    const answers = await runDesktop(
      world,
      Effect.gen(function* () {
        const source = yield* EngineSource;
        const before = yield* source.chosen;
        const waiting = yield* Effect.forkChild(source.firstChoice);
        const step = yield* source.use({ kind: 'local' });
        yield* Fiber.join(waiting);
        return [before, step, yield* source.chosen, yield* source.use({ kind: 'local' })];
      })
    );
    expect(answers).toEqual([false, 'none', true, 'none']);
    expect(JSON.parse(world.files.get(FILE) ?? '{}')).toEqual({ engineSource: { kind: 'local' } });
  });
});
