import type { Repo, Task } from '@shinsa/core';
import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { UpdateOptions, Workspace, WorkspaceCommit, WorkspaceStrategy } from './schema.ts';

export class EdgeWorkspace implements WorkspaceStrategy {
  readonly #workspace: Workspace;

  constructor(workspace: Workspace) {
    this.#workspace = workspace;
  }

  get mode() {
    return this.#workspace.mode;
  }

  prepare(repo: Repo, task: Task, signal?: AbortSignal) {
    return edgeRuntime.runPromise(this.#workspace.prepare(repo, task, signal));
  }

  commit(repo: Repo, task: Task, message: string): Promise<WorkspaceCommit> {
    return edgeRuntime.runPromise(
      Effect.map(this.#workspace.commit(repo, task, message), (commit) => ({
        treeHash: commit.treeHash,
        files: commit.files,
        undo: () => edgeRuntime.runPromise(commit.undo),
      }))
    );
  }

  push(repo: Repo, task: Task, signal?: AbortSignal) {
    return edgeRuntime.runPromise(this.#workspace.push(repo, task, signal));
  }

  remove(repo: Repo, task: Task) {
    return edgeRuntime.runPromise(this.#workspace.remove(repo, task));
  }

  writeEdit(repo: Repo, task: Task, path: string, write: () => boolean) {
    return edgeRuntime.runPromise(this.#workspace.writeEdit(repo, task, path, Effect.sync(write)));
  }

  syncBase(repo: Repo, task: Task, base: string, options: UpdateOptions) {
    return edgeRuntime.runPromise(
      this.#workspace.syncBase(repo, task, base, Effect.promise(options.onBehind), options.signal)
    );
  }
}
