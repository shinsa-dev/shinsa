import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Repo } from '@shinsa/core';
import { inspectRepo, resolveRepoRoot } from '../git/index.ts';
import { GITHUB_TIMEOUT_MS } from '../github/index.ts';
import type { Engine } from '../runtime/engine.ts';
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

export function listLocalRepos(roots: string[]): LocalRepo[] {
  const found = new Map<string, LocalRepo>();
  for (const root of roots) {
    for (const entry of readDirectory(root)) {
      const repo = selectLocalRepo(join(root, entry), entry);
      if (repo && !found.has(repo.path)) found.set(repo.path, repo);
    }
  }
  return [...found.values()].sort((a, b) => b.touchedAt - a.touchedAt).slice(0, MAX_LOCAL_REPOS);
}

let githubLogin: Promise<string | null> | null = null;

export function resolveGithubLogin() {
  githubLogin ??= runCommand(['gh', 'api', 'user', '--jq', '.login'], homedir(), {
    timeoutMs: GITHUB_TIMEOUT_MS,
  }).then((result) => (result.ok ? result.stdout.toLowerCase() : null));
  return githubLogin;
}

function titleCase(text: string) {
  return text
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

export async function resolveAreaName(remote: string | null, resolveLogin: LoginResolver) {
  const owner = remote?.split('/')[1]?.toLowerCase();
  if (!owner) return 'Local';
  if (owner === (await resolveLogin())) return 'Personal';
  return titleCase(owner);
}

function selectRepoByPath(engine: Engine, path: string) {
  return Object.values(engine.state.repos).find((repo) => repo.path === path) ?? null;
}

export async function upsertRepo(
  engine: Engine,
  path: string,
  resolveLogin: LoginResolver = resolveGithubLogin
): Promise<Repo> {
  const candidate = await inspectRepo(path);
  const known = selectRepoByPath(engine, candidate.path);
  if (known) return known;
  await engine.dispatch({
    type: 'repo.register',
    repo: { ...candidate, checkCommands: [], previewCommand: null },
    areaName: await resolveAreaName(candidate.remote, resolveLogin),
  });
  const registered = selectRepoByPath(engine, candidate.path);
  if (!registered) throw new Error(`Could not register ${candidate.name}.`);
  return registered;
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
