import type { DomainError } from '@shinsa/core';
import { Schema } from 'effect';
import type { RegistryFailure } from '../../repos/registry/schema.ts';

export class ProjectChangeFailed extends Schema.TaggedError<
  ProjectChangeFailed,
  { readonly brand: unique symbol }
>()('ProjectChangeFailed', { message: Schema.String }) {}

export type ProjectChangeFailure = DomainError | ProjectChangeFailed | RegistryFailure;

export interface LocalRepoView {
  path: string;
  name: string;
  repoId: string | null;
  projectId: string | null;
}
