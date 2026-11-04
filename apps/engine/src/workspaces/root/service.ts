import { accessSync, constants, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { ConfigStore } from '../../config/store/service.ts';
import {
  type ResolvedWorktreeRoot,
  WORKTREE_ROOT_MARKER,
  WORKTREE_ROOT_MARKER_TEXT,
  WorktreeRootUnavailable,
} from './schema.ts';

export class WorktreeRoot extends Context.Service<
  WorktreeRoot,
  {
    readonly resolve: Effect.Effect<ResolvedWorktreeRoot>;
    readonly path: Effect.Effect<string>;
    readonly assert: Effect.Effect<string, WorktreeRootUnavailable>;
    describeProblem(path: string, chosen?: boolean): Effect.Effect<string | null>;
    mark(path: string): Effect.Effect<string, WorktreeRootUnavailable>;
  }
>()('shinsa/engine/workspaces/root/WorktreeRoot') {
  static readonly layer = Layer.effect(
    WorktreeRoot,
    Effect.gen(function* () {
      const { worktreesDir, worktreesDirFromEnvironment } = yield* EngineConfig;
      const store = yield* ConfigStore;

      const resolve = Effect.gen(function* () {
        if (worktreesDirFromEnvironment) return { path: worktreesDir, source: 'environment' } as const;
        const configured = (yield* store.config).worktreesDir;
        if (configured) return { path: configured, source: 'config' } as const;
        return { path: worktreesDir, source: 'default' } as const;
      });

      const isWritable = (path: string) =>
        Effect.try(() => accessSync(path, constants.W_OK | constants.X_OK)).pipe(
          Effect.match({ onFailure: () => false, onSuccess: () => true })
        );

      const describeProblem = Effect.fn('WorktreeRoot.describeProblem')(function* (
        path: string,
        chosen = false
      ) {
        const folder = yield* Effect.sync(
          () => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? null
        );
        if (folder === null) {
          return `The worktree folder ${path} does not exist. If it is on a drive you mount, mount it again, or choose another folder in Settings → Projects.`;
        }
        if (!folder) return `The worktree folder ${path} is not a folder.`;
        if (!(yield* isWritable(path))) return `Shinsa cannot write to the worktree folder ${path}.`;
        if (chosen && !(yield* Effect.sync(() => existsSync(join(path, WORKTREE_ROOT_MARKER))))) {
          return `The worktree folder ${path} is not the one you chose: the drive it is on may not be mounted. Mount it again, or choose the folder again in Settings → Projects.`;
        }
        return null;
      });

      const mark = Effect.fn('WorktreeRoot.mark')(function* (path: string) {
        yield* Effect.try({
          try: () => writeFileSync(join(path, WORKTREE_ROOT_MARKER), WORKTREE_ROOT_MARKER_TEXT),
          catch: () =>
            new WorktreeRootUnavailable({
              path,
              message: `Shinsa cannot write to the worktree folder ${path}.`,
            }),
        });
        return path;
      });

      const assert = Effect.gen(function* () {
        const root = yield* resolve;
        if (root.source === 'default') return root.path;
        const problem = yield* describeProblem(root.path, root.source === 'config');
        if (problem) return yield* new WorktreeRootUnavailable({ path: root.path, message: problem });
        return root.path;
      });

      return WorktreeRoot.of({
        resolve,
        path: Effect.map(resolve, (root) => root.path),
        assert,
        describeProblem,
        mark,
      });
    })
  );
}
