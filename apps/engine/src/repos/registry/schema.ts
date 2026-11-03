import type { DomainError, ShinsaCommand, ShinsaEvent, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { DispatchOptions } from '../../runtime/engine/schema.ts';

export class RepoDispatchFailed extends Schema.TaggedError<
  RepoDispatchFailed,
  { readonly brand: unique symbol }
>()('RepoDispatchFailed', { message: Schema.String }) {}

export interface RepoRegistryDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (
    command: ShinsaCommand,
    options?: DispatchOptions
  ) => Effect.Effect<ShinsaEvent[], DomainError | RepoDispatchFailed>;
}

export type LoginLookup = Effect.Effect<string | null>;

export interface CreateRepositoryOptions {
  readonly login?: LoginLookup | null;
  readonly from?: DispatchOptions;
}
