import type { Repo, Task, WorkspaceMode } from '@shinsa/core';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { EngineConfig } from '../../src/config/service.ts';
import { ConfigStore } from '../../src/config/store/service.ts';
import { GitLayer } from '../../src/git/layers.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { WorkspacesServiceLayer } from '../../src/workspaces/layers.ts';
import { Workspaces } from '../../src/workspaces/service.ts';
import { createConfigAt } from '../helpers/config.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { createTempDir } from '../helpers/index.ts';

export function openWorkspaces(worktreesDir = createTempDir()) {
  const config = createConfigAt(createTempDir(), { worktreesDir });
  const runtime = ManagedRuntime.make(
    Layer.merge(
      WorkspacesServiceLayer.pipe(
        Layer.provideMerge(ConfigStore.layer.pipe(Layer.provide(JsonFileLayer))),
        Layer.provide(Layer.succeed(EngineConfig, config)),
        Layer.provide(GitLayer),
        Layer.provide(ShellLayer)
      ),
      JsonLogger
    )
  );
  const workspaces = runtime.runSync(Workspaces.use(Effect.succeed));
  const choose = (path: string | null) =>
    runtime.runPromise(
      ConfigStore.use((store) => Effect.asVoid(Effect.orDie(store.update({ worktreesDir: path }))))
    );
  return { runtime, workspaces, choose };
}

export function openStrategy(mode: WorkspaceMode, worktreesDir?: string) {
  const { runtime, workspaces, choose } = openWorkspaces(worktreesDir);
  const workspace = workspaces.resolve({ workspace: mode });
  return {
    mode: workspace.mode,
    choose,
    mark: (path: string) => runtime.runPromise(workspaces.root.mark(path)),
    prepare: (repo: Repo, task: Task, signal?: AbortSignal) =>
      runtime.runPromise(workspace.prepare(repo, task, signal)),
    commit: (repo: Repo, task: Task, message: string) =>
      runtime.runPromise(
        Effect.map(workspace.commit(repo, task, message), (commit) => ({
          treeHash: commit.treeHash,
          files: commit.files,
          undo: () => runtime.runPromise(commit.undo),
        }))
      ),
    push: (repo: Repo, task: Task, signal?: AbortSignal) =>
      runtime.runPromise(workspace.push(repo, task, signal)),
    remove: (repo: Repo, task: Task) => runtime.runPromise(workspace.remove(repo, task)),
    writeEdit: (repo: Repo, task: Task, path: string, write: () => boolean) =>
      runtime.runPromise(workspace.writeEdit(repo, task, path, Effect.sync(write))),
    syncBase: (
      repo: Repo,
      task: Task,
      base: string,
      options: { signal?: AbortSignal; onBehind: () => Promise<void> }
    ) =>
      runtime.runPromise(
        workspace.syncBase(repo, task, base, Effect.promise(options.onBehind), options.signal)
      ),
    describeProblem: (repo: Repo, holdsCheckout: boolean) =>
      runtime.runPromise(workspaces.describeProblem(repo, mode, holdsCheckout)),
  };
}
