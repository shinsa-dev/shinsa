import { join } from 'node:path';
import {
  DomainError,
  type Repo,
  resolveTaskProject,
  type ShinsaState,
  selectFolderProject,
  type Task,
} from '@shinsa/core';
import { Effect } from 'effect';
import { isInside } from '../files/paths.ts';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { DispatchOptions, Engine } from '../runtime/engine.ts';
import { resolveNewRepoParent } from './parent.ts';
import { resolveOwnerProjectName } from './project-name.ts';
import { type LoginLookup, RepoDispatchFailed } from './registry/schema.ts';
import { makeRepoRegistry } from './registry/service.ts';
import type { LocalRepo, LoginResolver } from './schema.ts';

function runRegistry<A, E>(
  engine: Engine,
  use: (registry: Effect.Success<ReturnType<typeof makeRepoRegistry>>) => Effect.Effect<A, E>
) {
  const registry = makeRepoRegistry({
    state: Effect.sync(() => engine.state),
    dispatch: (command, options) =>
      Effect.tryPromise({
        try: () => engine.dispatch(command, options),
        catch: (error) =>
          error instanceof DomainError ? error : new RepoDispatchFailed({ message: describeError(error) }),
      }),
  });
  return edgeRuntime.runPromise(Effect.flatMap(registry, use));
}

function resolveLoginLookup(resolveLogin: LoginResolver | null | undefined): LoginLookup | null {
  return resolveLogin ? Effect.promise(resolveLogin) : null;
}

export function resolveProjectName(remote: string | null, resolveLogin: LoginResolver | null) {
  return edgeRuntime.runPromise(resolveOwnerProjectName(remote, resolveLoginLookup(resolveLogin)));
}

export function syncRepoRemote(engine: Engine, repo: Repo) {
  return runRegistry(engine, (registry) => registry.syncRemote(repo));
}

export function upsertRepo(
  engine: Engine,
  path: string,
  resolveLogin: LoginResolver | null,
  projectId: string | null = null,
  from: DispatchOptions = {}
): Promise<Repo> {
  return runRegistry(engine, (registry) =>
    registry.upsert(path, resolveLoginLookup(resolveLogin), projectId, from)
  );
}

export function upsertProjectFolderRepo(engine: Engine, projectId: string | null, name: string) {
  return runRegistry(engine, (registry) => registry.upsertProjectFolder(projectId, name));
}

export function createRepository(
  engine: Engine,
  parent: string,
  name: string,
  projectId: string | null,
  options: { resolveLogin?: LoginResolver | null; from?: DispatchOptions } = {}
) {
  return runRegistry(engine, (registry) =>
    registry.create(parent, name, projectId, {
      login: resolveLoginLookup(options.resolveLogin),
      from: options.from,
    })
  );
}

export function createProjectRepository(engine: Engine, projectId: string, name: string) {
  return runRegistry(engine, (registry) => registry.createInProject(projectId, name));
}

export function resolveTaskRepoTarget(
  state: ShinsaState,
  task: Task,
  name: string,
  roots: readonly string[]
) {
  const projectId = resolveTaskProject(state, task);
  const parent = (projectId ? resolveNewRepoParent(state, projectId) : null) ?? roots[0] ?? null;
  if (!parent) return null;
  const folder = selectFolderProject(Object.values(state.projects), join(parent, name));
  return { parent, projectId: projectId ?? folder?.id ?? null };
}

export function resolveContainingRepo(path: string | null, repos: LocalRepo[]) {
  if (!path) return null;
  return repos.find((repo) => isInside(repo.path, path)) ?? null;
}

export {
  createLoginResolver,
  discoverRoots,
  listCandidateRepos,
  listLocalRepos,
  prepareSetup,
  readOriginRemote,
  verifySetup,
} from './edge.ts';
export { Roots } from './roots.ts';
export { REPOSITORY_NAME } from './schema.ts';
export type { Discoverer, LocalRepo, LoginResolver, RootSource } from './schema.ts';
