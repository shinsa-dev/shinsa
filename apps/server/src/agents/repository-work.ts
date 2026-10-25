import {
  listRepositoryWork,
  type RepositoryFiles,
  resolvePullRequestBase,
  serializeRepositoryWork,
  type Task,
} from '@shinsa/core';
import { listChangedFiles } from '../git/changed-files.ts';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { LedgerStore } from '../workspaces/ledger.ts';

interface Overlap {
  taskId: string;
  paths: string[];
}

function listOverlaps(files: Map<string, Set<string>>, taskId: string): Overlap[] {
  const own = files.get(taskId) ?? new Set<string>();
  return [...files]
    .filter(([otherId]) => otherId !== taskId)
    .map(([otherId, paths]) => ({
      taskId: otherId,
      paths: [...paths].filter((path) => own.has(path)).sort(),
    }))
    .filter((overlap) => overlap.paths.length > 0);
}

export class RepositoryWork {
  readonly #engine: Engine;
  readonly #ledgers: LedgerStore;

  constructor(engine: Engine, ledgers: LedgerStore) {
    this.#engine = engine;
    this.#ledgers = ledgers;
  }

  async describe(taskId: string, signal?: AbortSignal) {
    const tasks = this.#listTasks(taskId);
    const files: RepositoryFiles = {};
    const listed = await Promise.all(tasks.map((task) => this.#listFiles(task, signal)));
    tasks.forEach((task, index) => {
      files[task.id] = listed[index] ?? null;
    });
    return serializeRepositoryWork(this.#engine.state, taskId, files);
  }

  async recordOverlaps(taskId: string, planned: readonly string[], signal?: AbortSignal) {
    const tasks = this.#listTasks(taskId);
    if (tasks.length < 2) return;
    const listed = await Promise.all(tasks.map((task) => this.#listFiles(task, signal)));
    const files = new Map<string, Set<string>>();
    tasks.forEach((task, index) => {
      const paths = [...(listed[index] ?? []), ...(task.id === taskId ? planned : [])];
      files.set(task.id, new Set(paths));
    });
    for (const task of tasks) {
      const overlaps = listOverlaps(files, task.id);
      if (overlaps.length === 0) continue;
      const id = `overlaps:${task.id}:${Bun.hash(JSON.stringify(overlaps)).toString(36)}`;
      try {
        await this.#engine.dispatch(
          { type: 'task.record_overlaps', taskId: task.id, overlaps, from: taskId },
          { id }
        );
      } catch (error) {
        log.warn('[RepositoryWork] Could not record the files another task changes too', {
          taskId: task.id,
          error: describeError(error),
        });
      }
    }
  }

  #listTasks(taskId: string) {
    const task = this.#engine.state.tasks[taskId];
    const others = listRepositoryWork(this.#engine.state, taskId);
    return task && others.length > 0 ? [task, ...others] : [];
  }

  async #listFiles(task: Task, signal?: AbortSignal) {
    const state = this.#engine.state;
    const repo = task.repoId ? state.repos[task.repoId] : undefined;
    if (!repo) return null;
    try {
      const changed = await listChangedFiles(repo, task, resolvePullRequestBase(state, task), signal);
      if (task.workspace !== 'gitbutler') return changed;
      const ledger = this.#ledgers.read(repo.id);
      const owned = Object.entries(ledger.owners)
        .filter(([, owner]) => owner.taskId === task.id)
        .map(([path]) => path);
      return [...new Set([...changed, ...owned])].sort();
    } catch (error) {
      log.warn('[RepositoryWork] Could not list the files a task changed', {
        taskId: task.id,
        error: describeError(error),
      });
      return null;
    }
  }
}
