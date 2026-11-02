import { describe, expect, test } from 'bun:test';
import { Effect, Exit, Scope } from 'effect';
import { makeTaskScopes } from '../../../src/agents/supervisor/service.ts';

function track(closed: string[], scope: Scope.Closeable, name: string) {
  return Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      closed.push(name);
    })
  );
}

describe('a task scope', () => {
  test('stays open while any of its runs is open, and closes with the last one', async () => {
    const closed: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scopes = yield* makeTaskScopes();
          const first = yield* scopes.open('task-1');
          const second = yield* scopes.open('task-1');
          yield* track(closed, first, 'first');
          yield* track(closed, second, 'second');
          yield* scopes.close('task-1', first);
          expect(closed).toEqual(['first']);
          expect(yield* scopes.listTasks).toEqual(['task-1']);
          yield* scopes.close('task-1', second);
          expect(closed).toEqual(['first', 'second']);
          expect(yield* scopes.listTasks).toEqual([]);
          yield* scopes.close('task-1', second);
          expect(closed).toEqual(['first', 'second']);
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
          yield* track(closed, yield* scopes.open('task-1'), 'run-1');
          yield* track(closed, yield* scopes.open('task-1'), 'delegation');
          yield* track(closed, yield* scopes.open('task-2'), 'run-2');
          yield* scopes.closeTask('task-1');
          expect([...closed].sort()).toEqual(['delegation', 'run-1']);
          expect(yield* scopes.listTasks).toEqual(['task-2']);
          yield* scopes.closeTask('task-1');
        })
      )
    );
    expect([...closed].sort()).toEqual(['delegation', 'run-1', 'run-2']);
  });

  test('closing the scope it was made in closes every task', async () => {
    const closed: string[] = [];
    const root = Effect.runSync(Scope.make());
    const scopes = Effect.runSync(makeTaskScopes().pipe(Scope.provide(root)));
    Effect.runSync(Effect.flatMap(scopes.open('task-1'), (scope) => track(closed, scope, 'run-1')));
    Effect.runSync(Effect.flatMap(scopes.open('task-2'), (scope) => track(closed, scope, 'run-2')));
    await Effect.runPromise(Scope.close(root, Exit.void));
    expect([...closed].sort()).toEqual(['run-1', 'run-2']);
  });
});
