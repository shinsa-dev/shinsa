import { accessSync, constants, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { type ResolvedWorktreeRoot, type WorktreeRootOptions, WorktreeRootUnavailable } from './schema.ts';

export type { ResolvedWorktreeRoot, WorktreeRootOptions, WorktreeRootSource } from './schema.ts';
export { WorktreeRootUnavailable } from './schema.ts';

export class WorktreeRoot {
  readonly #options: WorktreeRootOptions;

  constructor(options: WorktreeRootOptions) {
    this.#options = options;
  }

  resolve(): ResolvedWorktreeRoot {
    const { defaultDir, fromEnvironment = false, readConfigured } = this.#options;
    if (fromEnvironment) return { path: defaultDir, source: 'environment' };
    const configured = readConfigured?.() ?? null;
    if (configured) return { path: configured, source: 'config' };
    return { path: defaultDir, source: 'default' };
  }

  get path() {
    return this.resolve().path;
  }
}

export const WORKTREE_ROOT_MARKER = '.shinsa-worktrees';

const MARKER_TEXT =
  'Shinsa keeps task worktrees in this folder. Remove this file and Shinsa stops using it.\n';

const isMarked = (path: string) => Effect.sync(() => existsSync(join(path, WORKTREE_ROOT_MARKER)));

const isFolder = (path: string) =>
  Effect.sync(() => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? null);

const isWritable = (path: string) =>
  Effect.try(() => accessSync(path, constants.W_OK | constants.X_OK)).pipe(
    Effect.match({ onFailure: () => false, onSuccess: () => true })
  );

export const describeWorktreeRootProblem = Effect.fn('WorktreeRoot.describeProblem')(function* (
  path: string,
  chosen = false
) {
  const folder = yield* isFolder(path);
  if (folder === null) {
    return `The worktree folder ${path} does not exist. If it is on a drive you mount, mount it again, or choose another folder in Settings → Projects.`;
  }
  if (!folder) return `The worktree folder ${path} is not a folder.`;
  if (!(yield* isWritable(path))) return `Shinsa cannot write to the worktree folder ${path}.`;
  if (chosen && !(yield* isMarked(path))) {
    return `The worktree folder ${path} is not the one you chose: the drive it is on may not be mounted. Mount it again, or choose the folder again in Settings → Projects.`;
  }
  return null;
});

export const markWorktreeRoot = Effect.fn('WorktreeRoot.mark')(function* (path: string) {
  yield* Effect.try({
    try: () => writeFileSync(join(path, WORKTREE_ROOT_MARKER), MARKER_TEXT),
    catch: () =>
      new WorktreeRootUnavailable({ path, message: `Shinsa cannot write to the worktree folder ${path}.` }),
  });
  return path;
});

export const assertWorktreeRoot = Effect.fn('WorktreeRoot.assert')(function* (root: ResolvedWorktreeRoot) {
  if (root.source === 'default') return root.path;
  const problem = yield* describeWorktreeRootProblem(root.path, root.source === 'config');
  if (problem) return yield* new WorktreeRootUnavailable({ path: root.path, message: problem });
  return root.path;
});

export const describeWorktreeRootMarkProblem = Effect.fn('WorktreeRoot.describeMarkProblem')(function* (
  path: string
) {
  return yield* markWorktreeRoot(path).pipe(
    Effect.match({ onFailure: (error) => error.message, onSuccess: () => null })
  );
});
