import { type ShinsaState, selectFolderProject } from '@shinsa/core';
import { listLocalRepos } from '../repos/folders/local.ts';
import type { LocalRepoView } from './changes/schema.ts';

export { ProjectChanges } from './changes/service.ts';

export function listLocalRepoViews(state: ShinsaState, roots: readonly string[]): LocalRepoView[] {
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
