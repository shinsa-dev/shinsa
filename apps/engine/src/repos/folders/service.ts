import type { Dirent } from 'node:fs';
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Clock, Context, Duration, Effect, FileSystem, Layer, Option } from 'effect';
import { normalizeRemote } from '../../git/remote/output.ts';
import { Remote } from '../../git/remote/service.ts';
import { selectErrnoCode } from '../../shell/errno.ts';
import {
  BUNDLE_SUFFIXES,
  DISCOVERY_BUDGET,
  type Discovery,
  type DiscoveryOptions,
  type DiscoveryScan,
  FolderUnreadable,
  type LocalRepo,
  MAX_DEPTH,
  MAX_DIRS,
  ORIGIN_SECTION,
  REFUSED_CODES,
  SAMPLE_REPOS,
  SECTION,
  SKIPPED_DIRS,
  URL_LINE,
} from '../schema.ts';
import { listLocalRepos } from './local.ts';

export class RepoFolders extends Context.Service<
  RepoFolders,
  {
    discover(home: string, options?: DiscoveryOptions): Effect.Effect<Discovery>;
    listLocal(roots: readonly string[], limit?: number): Effect.Effect<LocalRepo[]>;
    listCandidates(roots: readonly string[], origin: string | null): Effect.Effect<LocalRepo[]>;
    readOrigin(repo: string): Effect.Effect<string | null>;
  }
>()('shinsa/engine/repos/folders/RepoFolders') {
  static readonly layer = Layer.effect(
    RepoFolders,
    Effect.gen(function* () {
      const remote = yield* Remote;
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);

      const isSkipped = (name: string) =>
        name.startsWith('.') ||
        SKIPPED_DIRS.has(name) ||
        BUNDLE_SUFFIXES.some((suffix) => name.endsWith(suffix));

      const listChildren = (dir: string, entries: Dirent[]) =>
        entries
          .filter((entry) => entry.isDirectory() && !isSkipped(entry.name))
          .map((entry) => join(dir, entry.name));

      const isRepo = (entries: Dirent[]) =>
        entries.some((entry) => entry.name === '.git' && (entry.isDirectory() || entry.isFile()));

      const readEntries = (path: string) =>
        Effect.tryPromise({
          try: () => readdir(path, { withFileTypes: true }),
          catch: (error) => new FolderUnreadable({ path, code: selectErrnoCode(error) }),
        });

      const attempt = <A>(read: () => A) =>
        Effect.try(read).pipe(Effect.option, Effect.map(Option.getOrNull));

      const readText = (path: string) => attempt(() => readFileSync(path, 'utf8'));

      const resolveGitDir = Effect.fn('RepoFolders.resolveGitDir')(function* (repo: string) {
        const dotGit = join(repo, '.git');
        const stats = yield* attempt(() => statSync(dotGit));
        if (!stats) return null;
        if (stats.isDirectory()) return dotGit;
        const pointer = /^gitdir:\s*(.+)$/m.exec((yield* readText(dotGit)) ?? '')?.[1]?.trim();
        if (!pointer) return null;
        const gitDir = isAbsolute(pointer) ? pointer : resolve(repo, pointer);
        const common = (yield* readText(join(gitDir, 'commondir')))?.trim();
        if (!common) return gitDir;
        return isAbsolute(common) ? common : resolve(gitDir, common);
      });

      const readOriginUrl = (config: string) => {
        let inOrigin = false;
        for (const line of config.split('\n')) {
          if (SECTION.test(line)) {
            inOrigin = ORIGIN_SECTION.test(line);
            continue;
          }
          const url = inOrigin ? URL_LINE.exec(line)?.[1] : undefined;
          if (url) return url;
        }
        return null;
      };

      const recordEntries = (scan: DiscoveryScan, dir: string, entries: Dirent[], descend: boolean) => {
        if (dir !== scan.home && isRepo(entries)) {
          const parent = dirname(dir);
          scan.parents.set(parent, [...(scan.parents.get(parent) ?? []), basename(dir)]);
          return [];
        }
        return descend ? listChildren(dir, entries) : [];
      };

      const visit = (scan: DiscoveryScan, dir: string, descend: boolean) =>
        readEntries(dir).pipe(
          Effect.map((entries) => recordEntries(scan, dir, entries, descend)),
          Effect.catchTag('FolderUnreadable', (failure) =>
            Effect.sync(() => {
              if (REFUSED_CODES.has(failure.code ?? '')) scan.refused.push(dir);
              return [];
            })
          )
        );

      const rankCandidates = (parents: DiscoveryScan['parents']) =>
        [...parents.entries()]
          .map(([path, repos]) => ({
            path,
            repoCount: repos.length,
            repos: repos.sort((a, b) => a.localeCompare(b)).slice(0, SAMPLE_REPOS),
          }))
          .sort((a, b) => b.repoCount - a.repoCount || a.path.localeCompare(b.path));

      const discover = Effect.fn('RepoFolders.discover')(function* (
        home: string,
        options: DiscoveryOptions = {}
      ) {
        const maxDepth = options.maxDepth ?? MAX_DEPTH;
        const maxDirs = options.maxDirs ?? MAX_DIRS;
        const deadline =
          (yield* Clock.currentTimeMillis) + Duration.toMillis(options.budget ?? DISCOVERY_BUDGET);
        const scan: DiscoveryScan = { home, parents: new Map(), refused: [] };
        let queue = [home];
        let visited = 0;
        let truncated = false;
        for (let depth = 0; depth <= maxDepth && queue.length > 0 && !truncated; depth += 1) {
          const next: string[] = [];
          for (const dir of queue) {
            truncated = visited >= maxDirs || (yield* Clock.currentTimeMillis) >= deadline;
            if (truncated) break;
            visited += 1;
            next.push(...(yield* visit(scan, dir, depth < maxDepth)));
          }
          queue = next;
        }
        return {
          candidates: rankCandidates(scan.parents),
          truncated,
          refused: scan.refused.sort((a, b) => a.localeCompare(b)),
        } satisfies Discovery;
      });

      const listLocal = (roots: readonly string[], limit?: number) => withFiles(listLocalRepos(roots, limit));

      const listCandidates = Effect.fn('RepoFolders.listCandidates')(function* (
        roots: readonly string[],
        origin: string | null
      ) {
        const local = yield* listLocal(roots);
        if (!origin) return local;
        const root = yield* remote.resolveRoot(origin);
        if (!root || local.some((repo) => repo.path === root)) return local;
        return [{ path: root, name: basename(root), touchedAt: yield* Clock.currentTimeMillis }, ...local];
      });

      const readOrigin = Effect.fn('RepoFolders.readOrigin')(function* (repo: string) {
        const gitDir = yield* resolveGitDir(repo);
        const config = gitDir ? yield* readText(join(gitDir, 'config')) : null;
        const url = config ? readOriginUrl(config) : null;
        return url ? normalizeRemote(url) : null;
      });

      return RepoFolders.of({ discover, listLocal, listCandidates, readOrigin });
    })
  );
}
