import { accessSync, constants, statSync } from 'node:fs';
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

const isFolder = (path: string) =>
  Effect.sync(() => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? null);

const isWritable = (path: string) =>
  Effect.try(() => accessSync(path, constants.W_OK | constants.X_OK)).pipe(
    Effect.match({ onFailure: () => false, onSuccess: () => true })
  );

export const describeWorktreeRootProblem = Effect.fn('WorktreeRoot.describeProblem')(function* (
  path: string
) {
  const folder = yield* isFolder(path);
  if (folder === null) {
    return `The worktree folder ${path} does not exist. If it is on a drive you mount, mount it again, or choose another folder in Settings → Projects.`;
  }
  if (!folder) return `The worktree folder ${path} is not a folder.`;
  if (!(yield* isWritable(path))) return `Shinsa cannot write to the worktree folder ${path}.`;
  return null;
});

export const assertWorktreeRoot = Effect.fn('WorktreeRoot.assert')(function* (root: ResolvedWorktreeRoot) {
  if (root.source === 'default') return root.path;
  const problem = yield* describeWorktreeRootProblem(root.path);
  if (problem) return yield* new WorktreeRootUnavailable({ path: root.path, message: problem });
  return root.path;
});
