import type { Effect, Scope } from 'effect';

export interface TaskScope {
  readonly scope: Scope.Closeable;
  readonly open: number;
}

export interface TaskScopesHandle {
  readonly open: (taskId: string) => Effect.Effect<Scope.Closeable>;
  readonly close: (taskId: string, scope: Scope.Closeable) => Effect.Effect<void>;
  readonly closeTask: (taskId: string) => Effect.Effect<void>;
  readonly closeAll: Effect.Effect<void>;
  readonly listTasks: Effect.Effect<readonly string[]>;
}
