import type { DomainError } from '@shinsa/core';
import type { RegistryFailure } from '../../repos/registry/schema.ts';

export type ProjectChangeFailure = DomainError | RegistryFailure;

export interface LocalRepoView {
  path: string;
  name: string;
  repoId: string | null;
  projectId: string | null;
}
