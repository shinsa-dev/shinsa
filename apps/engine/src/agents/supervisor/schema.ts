import type { Effect, Scope } from 'effect';

interface TaskScope {
  readonly scope: Scope.Closeable;
  readonly open: number;
}

export interface RunScope {
  readonly taskId: string;
  readonly parentRunId: string | null;
  readonly scope: Scope.Closeable;
  readonly attempt: Scope.Closeable | null;
}

export interface RunScopeRequest {
  readonly taskId: string;
  readonly runId: string;
  readonly parentRunId: string | null;
}

export interface ScopeTable {
  readonly tasks: ReadonlyMap<string, TaskScope>;
  readonly runs: ReadonlyMap<string, RunScope>;
}

export interface TaskScopesHandle {
  readonly open: (request: RunScopeRequest) => Effect.Effect<Scope.Closeable>;
  readonly close: (runId: string) => Effect.Effect<void>;
  readonly closeRun: (runId: string) => Effect.Effect<void>;
  readonly closeTask: (taskId: string) => Effect.Effect<void>;
  readonly closeAll: Effect.Effect<void>;
  readonly listTasks: Effect.Effect<readonly string[]>;
}
