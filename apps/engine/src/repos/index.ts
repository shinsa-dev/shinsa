import { type Repo, resolveTaskProject, type Task } from '@shinsa/core';
import { inspectRepo, resolveRepoRemote } from '../git/index.ts';
import type { DispatchOptions, Engine } from '../runtime/engine.ts';
import { listLocalRepos } from './edge.ts';
import { type LocalRepo, type LoginResolver, RepoNotRegistered } from './schema.ts';

function titleCase(text: string) {
  return text
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

export async function resolveProjectName(remote: string | null, resolveLogin: LoginResolver | null) {
  const owner = remote?.split('/')[1]?.toLowerCase();
  if (!owner) return 'Local';
  if (owner === (await resolveLogin?.())) return 'Personal';
  return titleCase(owner);
}

async function resolveFallbackProjectName(
  engine: Engine,
  remote: string | null,
  resolveLogin: LoginResolver | null,
  projectId: string | null
) {
  if (projectId && engine.state.projects[projectId]) return null;
  return await resolveProjectName(remote, resolveLogin);
}

async function recordRepoRemote(engine: Engine, repo: Repo, remote: string) {
  await engine.dispatch({ type: 'repo.update', repoId: repo.id, patch: { remote } });
  return engine.state.repos[repo.id] ?? repo;
}

export async function syncRepoRemote(engine: Engine, repo: Repo) {
  if (repo.remote) return repo;
  const remote = await resolveRepoRemote(repo.path);
  if (!remote) return repo;
  return recordRepoRemote(engine, repo, remote);
}

function selectRepoByPath(engine: Engine, path: string) {
  return Object.values(engine.state.repos).find((repo) => repo.path === path) ?? null;
}

export async function upsertRepo(
  engine: Engine,
  path: string,
  resolveLogin: LoginResolver | null,
  projectId: string | null = null,
  from: DispatchOptions = {}
): Promise<Repo> {
  const candidate = await inspectRepo(path);
  const known = selectRepoByPath(engine, candidate.path);
  if (known && !known.remote && candidate.remote) return recordRepoRemote(engine, known, candidate.remote);
  if (known) return known;
  const projectName = await resolveFallbackProjectName(engine, candidate.remote, resolveLogin, projectId);
  await engine.dispatch(
    {
      type: 'repo.register',
      repo: { ...candidate, checkCommands: [] },
      projectName,
      projectId,
    },
    { ...from, id: from.id ?? `repo:${candidate.path}:${engine.state.seq}` }
  );
  const registered = selectRepoByPath(engine, candidate.path);
  if (!registered) {
    throw new RepoNotRegistered({ path: candidate.path, message: `Could not register ${candidate.name}.` });
  }
  return registered;
}

export async function upsertProjectFolderRepo(engine: Engine, task: Task, name: string) {
  const projectId = resolveTaskProject(engine.state, task);
  const project = projectId ? engine.state.projects[projectId] : undefined;
  if (!project) return null;
  const local = listLocalRepos(project.folders).find((repo) => repo.name === name);
  if (!local) return null;
  return await upsertRepo(engine, local.path, null, project.id);
}

export function resolveContainingRepo(path: string | null, repos: LocalRepo[]) {
  if (!path) return null;
  return repos.find((repo) => path === repo.path || path.startsWith(`${repo.path}/`)) ?? null;
}

export {
  createDiscoverer,
  createLoginResolver,
  discoverRoots,
  listCandidateRepos,
  listLocalRepos,
  readOriginRemote,
  verifySetup,
} from './edge.ts';
export { Roots } from './roots.ts';
export type { Discoverer, LocalRepo, LoginResolver, RootSource } from './schema.ts';
