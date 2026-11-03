import type { ShinsaCommand, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';

export interface Overlap {
  taskId: string;
  paths: string[];
}

export class OverlapRecordFailed extends Schema.TaggedError<
  OverlapRecordFailed,
  { readonly brand: unique symbol }
>()('OverlapRecordFailed', { message: Schema.String }) {}

export interface RepositoryWorkDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (command: ShinsaCommand, id: string) => Effect.Effect<void, OverlapRecordFailed>;
}

export interface RepositoryWorkHandle {
  readonly describe: (taskId: string, signal?: AbortSignal) => Effect.Effect<string>;
  readonly recordOverlaps: (
    taskId: string,
    planned: readonly string[],
    signal?: AbortSignal
  ) => Effect.Effect<void>;
}
