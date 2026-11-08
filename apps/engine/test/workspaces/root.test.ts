import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { ConfigStore } from '../../src/config/store/service.ts';
import { WORKTREE_ROOT_MARKER } from '../../src/workspaces/root/schema.ts';
import { WorktreeRoot } from '../../src/workspaces/root/service.ts';
import { createConfigAt } from '../helpers/config.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { createTempDir } from '../helpers/index.ts';

function runRoot<A, E>(
  effect: Effect.Effect<A, E, WorktreeRoot | ConfigStore>,
  overrides: Partial<ServerConfig> = {}
) {
  const config = createConfigAt(createTempDir(), overrides);
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        WorktreeRoot.layer.pipe(
          Layer.provideMerge(ConfigStore.layer),
          Layer.provide(Layer.merge(Layer.succeed(EngineConfig, config), JsonFileLayer))
        )
      )
    )
  );
}

const choose = (path: string | null) =>
  ConfigStore.use((store) => Effect.asVoid(Effect.orDie(store.update({ worktreesDir: path }))));

describe('the worktree folder', () => {
  test('the environment wins over config.json, and config.json over the default', async () => {
    const defaultDir = createTempDir();
    const resolved = await runRoot(
      Effect.gen(function* () {
        const root = yield* WorktreeRoot;
        yield* choose('/Volumes/bucket/worktrees');
        const configured = yield* root.resolve;
        yield* choose(null);
        return { configured, fallback: yield* root.resolve, path: yield* root.path };
      }),
      { worktreesDir: defaultDir }
    );
    expect(resolved).toEqual({
      configured: { path: '/Volumes/bucket/worktrees', source: 'config' },
      fallback: { path: defaultDir, source: 'default' },
      path: defaultDir,
    });
    const environmentDir = createTempDir();
    const fromEnvironment = await runRoot(
      Effect.gen(function* () {
        yield* choose('/Volumes/bucket/worktrees');
        return yield* (yield* WorktreeRoot).resolve;
      }),
      { worktreesDir: environmentDir, worktreesDirFromEnvironment: true }
    );
    expect(fromEnvironment).toEqual({ path: environmentDir, source: 'environment' });
  });

  test('a chosen folder must exist, be a folder and be writable', async () => {
    const base = createTempDir();
    const missing = join(base, 'bucket');
    const file = join(base, 'file');
    writeFileSync(file, '');
    const locked = join(base, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    const problems = await runRoot(
      Effect.gen(function* () {
        const root = yield* WorktreeRoot;
        const found = [
          yield* root.describeProblem(missing),
          yield* root.describeProblem(file),
          yield* root.describeProblem(locked),
        ];
        yield* Effect.sync(() => chmodSync(locked, 0o700));
        return [...found, yield* root.describeProblem(locked)];
      })
    );
    expect(problems).toEqual([
      `The worktree folder ${missing} does not exist. If it is on a drive you mount, mount it again, or choose another folder in Settings → Projects.`,
      `The worktree folder ${file} is not a folder.`,
      `Shinsa cannot write to the worktree folder ${locked}.`,
      null,
    ]);
  });

  test('only a chosen folder is checked; the default one is made when needed', async () => {
    const missing = join(createTempDir(), 'gone');
    expect(
      await runRoot(
        WorktreeRoot.use((root) => root.assert),
        { worktreesDir: missing }
      )
    ).toBe(missing);
    const failure = await runRoot(
      Effect.flip(
        Effect.gen(function* () {
          yield* choose(missing);
          return yield* (yield* WorktreeRoot).assert;
        })
      )
    );
    expect(failure._tag).toBe('WorktreeRootUnavailable');
    expect(failure.path).toBe(missing);
    const present = createTempDir();
    expect(
      await runRoot(
        WorktreeRoot.use((root) => root.assert),
        {
          worktreesDir: present,
          worktreesDirFromEnvironment: true,
        }
      )
    ).toBe(present);
  });

  test('a folder chosen in Settings must still hold the mark Shinsa left in it', async () => {
    const mountPoint = createTempDir();
    const locked = createTempDir();
    chmodSync(locked, 0o500);
    const outcome = await runRoot(
      Effect.gen(function* () {
        const root = yield* WorktreeRoot;
        yield* choose(mountPoint);
        const unmounted = yield* Effect.flip(root.assert);
        const marked = yield* root.mark(mountPoint);
        const mounted = yield* root.assert;
        const refused = yield* Effect.flip(root.mark(locked));
        return { unmounted: unmounted.message, marked, mounted, refused: refused.message };
      })
    );
    expect(outcome).toEqual({
      unmounted: `The worktree folder ${mountPoint} is not the one you chose: the drive it is on may not be mounted. Mount it again, or choose the folder again in Settings → Projects.`,
      marked: mountPoint,
      mounted: mountPoint,
      refused: `Shinsa cannot write to the worktree folder ${locked}.`,
    });
    expect(existsSync(join(mountPoint, WORKTREE_ROOT_MARKER))).toBe(true);
    chmodSync(locked, 0o700);
  });
});
