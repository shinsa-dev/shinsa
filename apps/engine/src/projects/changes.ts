import { DomainError, selectFolderProject } from '@shinsa/core';
import { Effect, Schema } from 'effect';
import { describeError } from '../log/redact.ts';
import { type LoginResolver, listLocalRepos, upsertRepo } from '../repos/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import { type LocalRepoView, ProjectChangeFailed } from './changes/schema.ts';
import { makeProjectChanges } from './changes/service.ts';

export type { ProjectChanges } from './changes/schema.ts';

interface ProjectChangesContext {
  engine: Engine;
  resolveLogin: LoginResolver;
  userHome: string;
}

const isDomainError = Schema.is(DomainError);

function resolveFailure(error: unknown) {
  return isDomainError(error) ? error : new ProjectChangeFailed({ message: describeError(error) });
}

export function listLocalRepoViews(engine: Engine, roots: string[]): LocalRepoView[] {
  const state = engine.state;
  const projects = Object.values(state.projects);
  const folders = projects.flatMap((project) => project.folders);
  const registered = new Map(Object.values(state.repos).map((repo) => [repo.path, repo]));
  const views = new Map<string, LocalRepoView>();
  for (const repo of Object.values(state.repos)) {
    views.set(repo.path, { path: repo.path, name: repo.name, repoId: repo.id, projectId: repo.projectId });
  }
  for (const local of listLocalRepos([...roots, ...folders])) {
    if (registered.has(local.path)) continue;
    const projectId = selectFolderProject(projects, local.path)?.id ?? null;
    views.set(local.path, { path: local.path, name: local.name, repoId: null, projectId });
  }
  return [...views.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function createProjectChanges({ engine, resolveLogin, userHome }: ProjectChangesContext) {
  return edgeRuntime.runSync(
    makeProjectChanges({
      state: Effect.sync(() => engine.state),
      userHome,
      dispatch: (command, from) =>
        Effect.tryPromise({ try: () => engine.dispatch(command, from), catch: resolveFailure }).pipe(
          Effect.asVoid
        ),
      registerRepo: (path, projectId, from) =>
        Effect.tryPromise({
          try: () => upsertRepo(engine, path, resolveLogin, projectId, from),
          catch: resolveFailure,
        }),
    })
  );
}
