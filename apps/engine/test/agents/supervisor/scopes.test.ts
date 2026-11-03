import { describe, expect, test } from 'bun:test';
import { Duration, Effect, Exit, Fiber, Scope } from 'effect';
import { makeTaskScopes } from '../../../src/agents/supervisor/scopes.ts';

function track(closed: string[], scope: Scope.Closeable, name: string) {
  return Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      closed.push(name);
    })
  );
}

function request(taskId: string, runId: string, parentRunId: string | null = null) {
  return { taskId, runId, parentRunId };
}

describe('a task scope', () => {
  test('stays open while any of its runs is open, and closes with the last one', async () => {
    const closed: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes();
          yield* track(closed, yield* scopes.open(request('task-1', 'run-1')), 'first');
          yield* track(closed, yield* scopes.open(request('task-1', 'run-2')), 'second');
          yield* scopes.close('run-1');
          expect(closed).toEqual(['first']);
          expect(yield* scopes.listTasks).toEqual(['task-1']);
          yield* scopes.close('run-2');
          expect(closed).toEqual(['first', 'second']);
          expect(yield* scopes.listTasks).toEqual([]);
          yield* scopes.close('run-2');
          expect(closed).toEqual(['first', 'second']);
        })
      )
    );
  });

  test('cancelling a run closes its scope and every delegation under it, in other tasks too', async () => {
    const closed: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes();
          yield* track(closed, yield* scopes.open(request('task-1', 'run-1')), 'run-1');
          yield* track(closed, yield* scopes.open(request('task-2', 'child', 'run-1')), 'child');
          yield* track(closed, yield* scopes.open(request('task-3', 'grandchild', 'child')), 'grandchild');
          yield* track(closed, yield* scopes.open(request('task-1', 'sibling')), 'sibling');
          yield* scopes.closeRun('run-1');
          expect(closed).toEqual(['grandchild', 'child', 'run-1']);
          yield* scopes.closeRun('missing');
          yield* scopes.close('grandchild');
          yield* scopes.close('child');
          yield* scopes.close('run-1');
          expect(yield* scopes.listTasks).toEqual(['task-1']);
        })
      )
    );
    expect(closed).toEqual(['grandchild', 'child', 'run-1', 'sibling']);
  });

  test('a run whose turn ends keeps its scope for its delegations, and gives it back after the last one', async () => {
    const closed: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes();
          yield* track(closed, yield* scopes.open(request('task-1', 'parent')), 'first turn');
          yield* track(closed, yield* scopes.open(request('task-2', 'child', 'parent')), 'child');
          yield* scopes.close('parent');
          expect(closed).toEqual(['first turn']);
          expect(yield* scopes.listTasks).toEqual(['task-1', 'task-2']);
          yield* track(closed, yield* scopes.open(request('task-1', 'parent')), 'woken turn');
          yield* scopes.close('parent');
          yield* scopes.close('child');
          expect(closed).toEqual(['first turn', 'woken turn', 'child']);
          expect(yield* scopes.listTasks).toEqual([]);
        })
      )
    );
  });

  test('cancelling a waiting run closes the delegations it kept its scope for', async () => {
    const closed: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes();
          yield* scopes.open(request('task-1', 'parent'));
          yield* scopes.open(request('task-2', 'child', 'parent'));
          yield* track(closed, yield* scopes.open(request('task-3', 'grandchild', 'child')), 'grandchild');
          yield* scopes.close('parent');
          yield* scopes.close('child');
          yield* scopes.closeRun('parent');
          expect(closed).toEqual(['grandchild']);
          yield* scopes.close('grandchild');
          expect(yield* scopes.listTasks).toEqual([]);
        })
      )
    );
  });

  test('a delegation whose parent has no scope opens under its own task', async () => {
    const closed: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes();
          yield* track(closed, yield* scopes.open(request('task-2', 'child', 'gone')), 'child');
          yield* scopes.closeTask('task-2');
          expect(closed).toEqual(['child']);
          expect(yield* scopes.listTasks).toEqual([]);
        })
      )
    );
  });

  test('closing a task closes every run in it and leaves other tasks open', async () => {
    const closed: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes();
          yield* track(closed, yield* scopes.open(request('task-1', 'run-1')), 'run-1');
          yield* track(closed, yield* scopes.open(request('task-1', 'run-2')), 'run-2');
          yield* track(closed, yield* scopes.open(request('task-2', 'run-3')), 'run-3');
          yield* scopes.closeTask('task-1');
          expect([...closed].sort()).toEqual(['run-1', 'run-2']);
          expect(yield* scopes.listTasks).toEqual(['task-2']);
          yield* scopes.closeTask('task-1');
        })
      )
    );
    expect([...closed].sort()).toEqual(['run-1', 'run-2', 'run-3']);
  });

  test('closing the scope it was made in closes every task', async () => {
    const closed: string[] = [];
    const root = Effect.runSync(Scope.make());
    const scopes = Effect.runSync(makeTaskScopes().pipe(Scope.provide(root)));
    Effect.runSync(
      Effect.flatMap(scopes.open(request('task-1', 'run-1')), (scope) => track(closed, scope, 'run-1'))
    );
    Effect.runSync(
      Effect.flatMap(scopes.open(request('task-2', 'run-2')), (scope) => track(closed, scope, 'run-2'))
    );
    await Effect.runPromise(Scope.close(root, Exit.void));
    expect([...closed].sort()).toEqual(['run-1', 'run-2']);
  });

  test('closing a run’s scope gives its fiber the grace to finish, then interrupts it', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes(Duration.millis(20));
          const quick = yield* Effect.forkChild(Effect.sleep(Duration.millis(5)));
          const stuck = yield* Effect.forkChild(Effect.never);
          yield* scopes.open({ ...request('task-1', 'quick'), fiber: quick });
          yield* scopes.open({ ...request('task-1', 'stuck'), fiber: stuck });
          yield* scopes.closeRun('quick');
          expect(Exit.isSuccess(yield* Fiber.await(quick))).toBe(true);
          yield* scopes.closeRun('stuck');
          expect(Exit.hasInterrupts(yield* Fiber.await(stuck))).toBe(true);
        })
      )
    );
  });

  test('a run that closes its own scope is not interrupted by it', async () => {
    const after = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes(Duration.millis(20));
          const own = Effect.gen(function* () {
            yield* scopes.open({ ...request('task-1', 'run-1'), fiber: yield* Effect.fiber });
            yield* scopes.close('run-1');
            return 'settled';
          });
          return yield* Fiber.join(yield* Effect.forkChild(own));
        })
      )
    );
    expect(after).toBe('settled');
  });

  test('a run that executes again under its kept scope is bounded by its new fiber', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes(Duration.millis(20));
          const first = yield* Effect.forkChild(Effect.void);
          yield* scopes.open({ ...request('task-1', 'parent'), fiber: first });
          yield* scopes.open({ ...request('task-1', 'child'), parentRunId: 'parent' });
          yield* scopes.close('parent');
          yield* Fiber.await(first);
          const second = yield* Effect.forkChild(Effect.never);
          yield* scopes.open({ ...request('task-1', 'parent'), fiber: second });
          yield* scopes.closeRun('parent');
          expect(Exit.hasInterrupts(yield* Fiber.await(second))).toBe(true);
        })
      )
    );
  });
});
