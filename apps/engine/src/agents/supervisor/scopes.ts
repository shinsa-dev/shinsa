import { Duration, Effect, Exit, Fiber, Option, Ref, Scope } from 'effect';
import {
  type RunScope,
  type RunScopeRequest,
  STOP_MS,
  type ScopeTable,
  type TaskScopesHandle,
} from './schema.ts';

const settleOrInterrupt = (fiber: Fiber.Fiber<unknown, unknown>, grace: Duration.Duration) =>
  Effect.withFiber((current) => {
    if (current.id === fiber.id) return Effect.void;
    return Fiber.await(fiber).pipe(
      Effect.timeoutOption(grace),
      Effect.interruptible,
      Effect.flatMap((settled) =>
        Option.isSome(settled) ? Effect.void : Effect.asVoid(Effect.forkDetach(Fiber.interrupt(fiber)))
      )
    );
  });

export const makeTaskScopes = Effect.fn('TaskScopes.make')(function* (
  grace: Duration.Duration = Duration.millis(STOP_MS)
) {
  const root = yield* Scope.Scope;
  const table = yield* Ref.make<ScopeTable>({ tasks: new Map(), runs: new Map() });

  const closeTask = Effect.fn('TaskScopes.closeTask')(function* (taskId: string) {
    const task = yield* Ref.modify(table, (current) => {
      const tasks = new Map(current.tasks);
      tasks.delete(taskId);
      const runs = new Map([...current.runs].filter(([, run]) => run.taskId !== taskId));
      return [current.tasks.get(taskId), { tasks, runs }] as const;
    });
    if (task) yield* Scope.close(task.scope, Exit.void);
  });

  const open = Effect.fn('TaskScopes.open')(function* ({
    taskId,
    runId,
    parentRunId,
    fiber,
  }: RunScopeRequest) {
    const current = yield* Ref.get(table);
    const kept = current.runs.get(runId);
    if (kept) {
      const attempt = yield* Scope.fork(kept.scope);
      yield* Ref.update(table, (latest) => ({
        ...latest,
        runs: new Map(latest.runs).set(runId, { ...kept, attempt }),
      }));
      return attempt;
    }
    const existing = current.tasks.get(taskId);
    const task = existing
      ? { ...existing, open: existing.open + 1 }
      : { scope: yield* Scope.fork(root), open: 1 };
    const parent = parentRunId === null ? undefined : current.runs.get(parentRunId);
    const scope = yield* Scope.fork(parent?.scope ?? task.scope);
    if (fiber) yield* Scope.addFinalizer(scope, settleOrInterrupt(fiber, grace));
    const attempt = yield* Scope.fork(scope);
    const run: RunScope = { taskId, parentRunId, scope, attempt };
    yield* Ref.update(table, (latest) => ({
      tasks: new Map(latest.tasks).set(taskId, task),
      runs: new Map(latest.runs).set(runId, run),
    }));
    return attempt;
  });

  const hasChildren = (runs: ScopeTable['runs'], runId: string) =>
    [...runs.values()].some((run) => run.parentRunId === runId);

  const release = Effect.fn('TaskScopes.release')(function* (runId: string): Effect.fn.Return<void> {
    const run = yield* Ref.modify(table, (current) => {
      const runs = new Map(current.runs);
      runs.delete(runId);
      return [current.runs.get(runId), { ...current, runs }] as const;
    });
    if (!run) return;
    yield* Scope.close(run.scope, Exit.void);
    const current = yield* Ref.get(table);
    const task = current.tasks.get(run.taskId);
    if (task && task.open > 1) {
      yield* Ref.update(table, (latest) => ({
        ...latest,
        tasks: new Map(latest.tasks).set(run.taskId, { ...task, open: task.open - 1 }),
      }));
    } else if (task) {
      yield* closeTask(run.taskId);
    }
    const parent = run.parentRunId === null ? undefined : current.runs.get(run.parentRunId);
    if (parent && parent.attempt === null && !hasChildren(current.runs, run.parentRunId ?? '')) {
      yield* release(run.parentRunId ?? '');
    }
  });

  const close = Effect.fn('TaskScopes.close')(function* (runId: string) {
    const current = yield* Ref.get(table);
    const run = current.runs.get(runId);
    if (!run) return;
    if (run.attempt) yield* Scope.close(run.attempt, Exit.void);
    if (!hasChildren(current.runs, runId)) return yield* release(runId);
    yield* Ref.update(table, (latest) => ({
      ...latest,
      runs: new Map(latest.runs).set(runId, { ...run, attempt: null }),
    }));
  });

  const listKept = (runs: ScopeTable['runs'], runId: string): string[] => {
    const below = [...runs].filter(([, run]) => run.parentRunId === runId).map(([id]) => id);
    const kept = runs.get(runId)?.attempt === null ? [runId] : [];
    return [...below.flatMap((id) => listKept(runs, id)), ...kept];
  };

  const closeRun = Effect.fn('TaskScopes.closeRun')(function* (runId: string) {
    const current = yield* Ref.get(table);
    const run = current.runs.get(runId);
    if (!run) return;
    yield* Scope.close(run.scope, Exit.void);
    yield* Effect.forEach(listKept(current.runs, runId), release, { discard: true });
  });

  const listTasks = Effect.map(Ref.get(table), (current) => [...current.tasks.keys()]);

  const closeAll = Effect.flatMap(listTasks, (taskIds) =>
    Effect.forEach(taskIds, closeTask, { concurrency: 'unbounded', discard: true })
  );

  yield* Effect.addFinalizer(() => closeAll);

  const handle: TaskScopesHandle = { open, close, closeRun, closeTask, closeAll, listTasks };
  return handle;
});
