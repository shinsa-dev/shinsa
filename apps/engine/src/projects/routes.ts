import { DomainError, type Project, type Repo, selectFolderProject } from '@shinsa/core';
import { resolveRepoRoot } from '../git/index.ts';
import { type LoginResolver, listLocalRepos, upsertRepo } from '../repos/index.ts';
import type { DispatchOptions, Engine } from '../runtime/engine.ts';
import { resolveProjectFolder } from './folders.ts';

interface ProjectChangesContext {
  engine: Engine;
  resolveLogin: LoginResolver;
  userHome: string;
}

export interface ProjectChanges {
  upsertRepo: (projectId: string, path: string, from?: DispatchOptions) => Promise<{ repo: Repo }>;
  upsertFolder: (projectId: string, path: string, from?: DispatchOptions) => Promise<{ project: Project }>;
}

interface LocalRepoView {
  path: string;
  name: string;
  repoId: string | null;
  projectId: string | null;
}

function findProject(engine: Engine, projectId: string) {
  const project = engine.state.projects[projectId];
  if (!project) throw new DomainError({ code: 'project_not_found', message: `No project ${projectId}.` });
  return project;
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

export function createProjectChanges({
  engine,
  resolveLogin,
  userHome,
}: ProjectChangesContext): ProjectChanges {
  return {
    upsertRepo: async (projectId, raw, from = {}) => {
      findProject(engine, projectId);
      const path = resolveProjectFolder(raw, userHome);
      if (!(await resolveRepoRoot(path))) {
        throw new DomainError({ code: 'repo_invalid', message: `${path} is not a git repository.` });
      }
      const repo = await upsertRepo(engine, path, resolveLogin, projectId, from);
      if (repo.projectId !== projectId) {
        await engine.dispatch({ type: 'repo.update', repoId: repo.id, patch: { projectId } }, from);
      }
      return { repo: engine.state.repos[repo.id] ?? repo };
    },
    upsertFolder: async (projectId, raw, from = {}) => {
      const project = findProject(engine, projectId);
      const folder = resolveProjectFolder(raw, userHome);
      if (project.folders.includes(folder)) return { project };
      await engine.dispatch(
        { type: 'project.write', project: { ...project, folders: [...project.folders, folder] } },
        from
      );
      return { project: engine.state.projects[projectId] ?? project };
    },
  };
}
