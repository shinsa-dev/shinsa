import type { DomainError, Project, Repo, ShinsaCommand, ShinsaState } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { DispatchOptions } from '../../runtime/engine.ts';

export class ProjectChangeFailed extends Schema.TaggedError<
  ProjectChangeFailed,
  { readonly brand: unique symbol }
>()('ProjectChangeFailed', { message: Schema.String }) {}

type ProjectChangeFailure = DomainError | ProjectChangeFailed;

export interface ProjectChangesDefinition {
  state: Effect.Effect<ShinsaState>;
  userHome: string;
  dispatch: (command: ShinsaCommand, from: DispatchOptions) => Effect.Effect<void, ProjectChangeFailure>;
  registerRepo: (
    path: string,
    projectId: string,
    from: DispatchOptions
  ) => Effect.Effect<Repo, ProjectChangeFailure>;
}

export interface ProjectChanges {
  upsertRepo: (
    projectId: string,
    path: string,
    from?: DispatchOptions
  ) => Effect.Effect<{ repo: Repo }, ProjectChangeFailure>;
  upsertFolder: (
    projectId: string,
    path: string,
    from?: DispatchOptions
  ) => Effect.Effect<{ project: Project }, ProjectChangeFailure>;
}

export interface LocalRepoView {
  path: string;
  name: string;
  repoId: string | null;
  projectId: string | null;
}
