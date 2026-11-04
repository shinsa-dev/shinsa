import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type LocalRepo, MAX_LOCAL_REPOS } from '../schema.ts';

function attempt<A>(read: () => A) {
  try {
    return read();
  } catch {
    return null;
  }
}

function selectLocalRepo(path: string, name: string) {
  return attempt((): LocalRepo | null => {
    const stats = statSync(path);
    if (!stats.isDirectory() || !existsSync(join(path, '.git'))) return null;
    return { path: realpathSync(path), name, touchedAt: stats.mtimeMs };
  });
}

export function listLocalRepos(roots: readonly string[], limit = MAX_LOCAL_REPOS) {
  const found = new Map<string, LocalRepo>();
  for (const root of roots) {
    const entries = attempt(() => (statSync(root).isDirectory() ? readdirSync(root) : []));
    for (const entry of entries ?? []) {
      const repo = selectLocalRepo(join(root, entry), entry);
      if (repo && !found.has(repo.path)) found.set(repo.path, repo);
    }
  }
  return [...found.values()].sort((a, b) => b.touchedAt - a.touchedAt).slice(0, limit);
}
