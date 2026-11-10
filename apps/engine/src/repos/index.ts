import { join } from 'node:path';
import { resolveTaskProject, type ShinsaState, selectFolderProject, type Task } from '@shinsa/core';
import { Option } from 'effect';
import { isInside } from '../files/paths.ts';
import { resolveNewRepoParent } from './parent.ts';
import type { LocalRepo } from './schema.ts';

export function resolveTaskRepoTarget(
  state: ShinsaState,
  task: Task,
  name: string,
  roots: readonly string[]
) {
  const projectId = Option.getOrNull(resolveTaskProject(state, task));
  const parent = (projectId ? resolveNewRepoParent(state, projectId) : null) ?? roots[0] ?? null;
  if (!parent) return null;
  const folder = selectFolderProject(Object.values(state.projects), join(parent, name));
  return { parent, projectId: projectId ?? folder?.id ?? null };
}

export function resolveContainingRepo(path: string | null, repos: LocalRepo[]) {
  if (!path) return null;
  return repos.find((repo) => isInside(repo.path, path)) ?? null;
}

export { listLocalRepos } from './folders/local.ts';
export { RepoFolders } from './folders/service.ts';
export type { LoginLookup } from './registry/schema.ts';
export { Roots } from './roots/service.ts';
export { REPOSITORY_NAME } from './schema.ts';
export type { Discoverer, LocalRepo, LoginResolver, RootSource } from './schema.ts';
