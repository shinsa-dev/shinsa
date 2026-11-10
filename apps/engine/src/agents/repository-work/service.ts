import {
  listRepositoryWork,
  type RepositoryFiles,
  resolveRoundBase,
  serializeRepositoryWork,
  type Task,
} from '@shinsa/core';
import { Context, Effect, Layer, Option } from 'effect';
import { History } from '../../git/history/service.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import type { Overlap } from './schema.ts';

export class RepositoryWork extends Context.Service<
  RepositoryWork,
  {
    readonly describe: (taskId: string, signal?: AbortSignal) => Effect.Effect<string>;
    readonly recordOverlaps: (
      taskId: string,
      planned: readonly string[],
      signal?: AbortSignal
    ) => Effect.Effect<void>;
  }
>()('shinsa/engine/agents/repository-work/RepositoryWork') {
  static readonly layer = Layer.effect(
    RepositoryWork,
    Effect.gen(function* () {
      const history = yield* History;
      const engine = yield* EngineCore;

      const listOverlaps = (files: Map<string, Set<string>>, taskId: string): Overlap[] => {
        const own = files.get(taskId) ?? new Set<string>();
        return [...files]
          .filter(([otherId]) => otherId !== taskId)
          .map(([otherId, paths]) => ({
            taskId: otherId,
            paths: [...paths].filter((path) => own.has(path)).sort(),
          }))
          .filter((overlap) => overlap.paths.length > 0);
      };

      const listTasks = Effect.fn('RepositoryWork.listTasks')(function* (taskId: string) {
        const state = yield* engine.state;
        const task = state.tasks[taskId];
        const others = listRepositoryWork(state, taskId);
        return task && others.length > 0 ? [task, ...others] : [];
      });

      const listFiles = Effect.fn('RepositoryWork.listFiles')(function* (task: Task, signal?: AbortSignal) {
        const state = yield* engine.state;
        const repo = task.repoId ? state.repos[task.repoId] : undefined;
        if (!repo) return null;
        return yield* history
          .changedFiles(repo, task, Option.getOrNull(resolveRoundBase(task)), signal)
          .pipe(
            Effect.catch((failure) =>
              Effect.logWarning('[RepositoryWork] Could not list the files a task changed').pipe(
                Effect.annotateLogs({ taskId: task.id, error: failure.message }),
                Effect.as(null)
              )
            )
          );
      });

      const listAllFiles = (tasks: Task[], signal?: AbortSignal) =>
        Effect.forEach(tasks, (task) => listFiles(task, signal), { concurrency: 'unbounded' });

      const describe = Effect.fn('RepositoryWork.describe')(function* (taskId: string, signal?: AbortSignal) {
        const tasks = yield* listTasks(taskId);
        const listed = yield* listAllFiles(tasks, signal);
        const files: RepositoryFiles = {};
        tasks.forEach((task, index) => {
          files[task.id] = listed[index] ?? null;
        });
        return serializeRepositoryWork(yield* engine.state, taskId, files);
      });

      const recordOverlaps = Effect.fn('RepositoryWork.recordOverlaps')(function* (
        taskId: string,
        planned: readonly string[],
        signal?: AbortSignal
      ) {
        const tasks = yield* listTasks(taskId);
        if (tasks.length < 2) return;
        const listed = yield* listAllFiles(tasks, signal);
        const files = new Map<string, Set<string>>();
        tasks.forEach((task, index) => {
          const paths = [...(listed[index] ?? []), ...(task.id === taskId ? planned : [])];
          files.set(task.id, new Set(paths));
        });
        for (const task of tasks) {
          const overlaps = listOverlaps(files, task.id);
          if (overlaps.length === 0) continue;
          const id = `overlaps:${task.id}:${Bun.hash(JSON.stringify(overlaps)).toString(36)}`;
          yield* engine
            .dispatch({ type: 'task.record_overlaps', taskId: task.id, overlaps, from: taskId }, { id })
            .pipe(
              Effect.catch((failure) =>
                Effect.logWarning(
                  '[RepositoryWork] Could not record the files another task changes too'
                ).pipe(Effect.annotateLogs({ taskId: task.id, error: failure.message }))
              )
            );
        }
      });

      return RepositoryWork.of({ describe, recordOverlaps });
    })
  );
}
