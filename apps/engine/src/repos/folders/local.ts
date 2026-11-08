import { join } from 'node:path';
import { Effect, FileSystem, Option } from 'effect';
import { isFolder, isPresent, listEntries } from '../../files/probe.ts';
import { type LocalRepo, MAX_LOCAL_REPOS } from '../schema.ts';

const selectLocalRepo = Effect.fn('RepoFolders.selectLocalRepo')(function* (path: string, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* Effect.option(fs.stat(path));
  if (Option.isNone(info) || info.value.type !== 'Directory') return Option.none<LocalRepo>();
  if (!(yield* isPresent(join(path, '.git')))) return Option.none<LocalRepo>();
  const real = yield* Effect.option(fs.realPath(path));
  const { mtime } = info.value;
  const touchedAt = Option.isSome(mtime) ? mtime.value.getTime() : 0;
  return Option.map(real, (resolved): LocalRepo => ({ path: resolved, name, touchedAt }));
});

export const listLocalRepos = Effect.fn('RepoFolders.listLocalRepos')(function* (
  roots: readonly string[],
  limit = MAX_LOCAL_REPOS
) {
  const found = new Map<string, LocalRepo>();
  for (const root of roots) {
    const entries = (yield* isFolder(root)) ? yield* listEntries(root) : [];
    for (const entry of entries) {
      const repo = yield* selectLocalRepo(join(root, entry), entry);
      if (Option.isSome(repo) && !found.has(repo.value.path)) found.set(repo.value.path, repo.value);
    }
  }
  return [...found.values()].sort((a, b) => b.touchedAt - a.touchedAt).slice(0, limit);
});
