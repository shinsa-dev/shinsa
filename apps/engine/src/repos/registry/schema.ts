import type { DomainError } from '@shinsa/core';
import type { Effect } from 'effect';
import type { GitFailed } from '../../git/schema.ts';
import type { DispatchOptions, EngineStopped } from '../../runtime/engine/schema.ts';
import type { RepoNotCreated, RepoNotRegistered } from '../schema.ts';

export type LoginLookup = Effect.Effect<string | null>;

export interface CreateRepositoryOptions {
  readonly login?: LoginLookup | null;
  readonly from?: DispatchOptions;
}

export type RegistryFailure = DomainError | EngineStopped | GitFailed | RepoNotRegistered | RepoNotCreated;
