import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Repo, resolveTaskProject, type Task } from '@shinsa/core';
import { inspectRepo, resolveRepoRemote, resolveRepoRoot } from '../git/index.ts';
import { GITHUB_TIMEOUT_MS } from '../github/index.ts';
import type { DispatchOptions, Engine } from '../runtime/engine.ts';
import { runCommand } from '../shell/index.ts';

export interface LocalRepo {
  path: string;
  name: string;
  touchedAt: number;
}

export type LoginResolver = () => Promise<string | null>;

const MAX_LOCAL_REPOS = 80;

function readDirectory(path: string) {
  try {
    return statSync(path).isDirectory() ? readdirSync(path) : [];
  } catch {
    return [];
  }
}

function selectLocalRepo(path: string, name: string): LocalRepo | null {
  try {
    const stats = statSync(path);
    if (!stats.isDirectory() || !existsSync(join(path, '.git'))) return null;
    return { path: realpathSync(path), name, touchedAt: stats.mtimeMs };
  } catch {
    return null;
  }
}

export function listLocalRepos(roots: string[], limit = MAX_LOCAL_REPOS): LocalRepo[] {
  const found = new Map<string, LocalRepo>();
  for (const root of roots) {
    for (const entry of readDirectory(root)) {
      const repo = selectLocalRepo(join(root, entry), entry);
      if (repo && !found.has(repo.path)) found.set(repo.path, repo);
    }
  }
  return [...found.values()].sort((a, b) => b.touchedAt - a.touchedAt).slice(0, limit);
}

export function createLoginResolver(cwd: string): LoginResolver {
  let login: Promise<string | null> | null = null;
  return () => {
    login ??= runCommand(['gh', 'api', 'user', '--jq', '.login'], cwd, {
      timeoutMs: GITHUB_TIMEOUT_MS,
    }).then((result) => {
      if (result.ok) return result.stdout.toLowerCase();
      login = null;
      return null;
    });
    return login;
  };
}

function titleCase(text: string) {
  return text
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

export async function resolveProjectName(remote: string | null, resolveLogin: LoginResolver) {
  const owner = remote?.split('/')[1]?.toLowerCase();
  if (!owner) return 'Local';
  if (owner === (await resolveLogin())) return 'Personal';
  return titleCase(owner);
}

async function resolveFallbackProjectName(
  engine: Engine,
  remote: string | null,
  resolveLogin: LoginResolver,
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
  resolveLogin: LoginResolver,
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
  if (!registered) throw new Error(`Could not register ${candidate.name}.`);
  return registered;
}

export async function upsertProjectFolderRepo(engine: Engine, task: Task, name: string) {
  const projectId = resolveTaskProject(engine.state, task);
  const project = projectId ? engine.state.projects[projectId] : undefined;
  if (!project) return null;
  const local = listLocalRepos(project.folders).find((repo) => repo.name === name);
  if (!local) return null;
  return await upsertRepo(engine, local.path, () => Promise.resolve(null), project.id);
}

export function resolveContainingRepo(path: string | null, repos: LocalRepo[]) {
  if (!path) return null;
  return repos.find((repo) => path === repo.path || path.startsWith(`${repo.path}/`)) ?? null;
}

export async function listCandidateRepos(roots: string[], origin: string | null) {
  const local = listLocalRepos(roots);
  if (!origin) return local;
  const root = await resolveRepoRoot(origin);
  if (!root || local.some((repo) => repo.path === root)) return local;
  return [{ path: root, name: basename(root), touchedAt: Date.now() }, ...local];
}

export { createDiscoverer, discoverRoots } from './discover.ts';
export { readOriginRemote } from './remote.ts';
export { type Discoverer, type RootSource, Roots } from './roots.ts';
export { verifySetup } from './setup.ts';
