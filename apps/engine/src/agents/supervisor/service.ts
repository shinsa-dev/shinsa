import { Effect, Exit, Ref, Scope } from 'effect';
import type { TaskScope, TaskScopesHandle } from './schema.ts';

export const makeTaskScopes = Effect.fn('TaskScopes.make')(function* () {
  const root = yield* Scope.Scope;
  const tasks = yield* Ref.make<ReadonlyMap<string, TaskScope>>(new Map());

  const remove = (taskId: string) =>
    Ref.modify(tasks, (current) => {
      const next = new Map(current);
      next.delete(taskId);
      return [current.get(taskId), next] as const;
    });

  const closeTask = Effect.fn('TaskScopes.closeTask')(function* (taskId: string) {
    const task = yield* remove(taskId);
    if (task) yield* Scope.close(task.scope, Exit.void);
  });

  const open = Effect.fn('TaskScopes.open')(function* (taskId: string) {
    const existing = (yield* Ref.get(tasks)).get(taskId);
    const task: TaskScope = existing
      ? { ...existing, open: existing.open + 1 }
      : { scope: yield* Scope.fork(root), open: 1 };
    yield* Ref.update(tasks, (current) => new Map(current).set(taskId, task));
    return yield* Scope.fork(task.scope);
  });

  const close = Effect.fn('TaskScopes.close')(function* (taskId: string, scope: Scope.Closeable) {
    yield* Scope.close(scope, Exit.void);
    const task = (yield* Ref.get(tasks)).get(taskId);
    if (!task) return;
    if (task.open > 1) {
      yield* Ref.update(tasks, (current) => new Map(current).set(taskId, { ...task, open: task.open - 1 }));
      return;
    }
    yield* closeTask(taskId);
  });

  const listTasks = Effect.map(Ref.get(tasks), (current) => [...current.keys()]);

  const closeAll = Effect.flatMap(listTasks, (taskIds) =>
    Effect.forEach(taskIds, closeTask, { concurrency: 'unbounded', discard: true })
  );

  yield* Effect.addFinalizer(() => closeAll);

  const handle: TaskScopesHandle = { open, close, closeTask, closeAll, listTasks };
  return handle;
});
