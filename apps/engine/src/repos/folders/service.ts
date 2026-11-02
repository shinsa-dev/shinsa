import type { Dirent } from 'node:fs';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Clock, Context, Effect, Layer, Option } from 'effect';
import { normalizeRemote } from '../../git/remote/output.ts';
import { Remote } from '../../git/remote/service.ts';
import {
  type Discovery,
  type DiscoveryOptions,
  type LocalRepo,
  MAX_DEPTH,
  MAX_DIRS,
  MAX_LOCAL_REPOS,
  ORIGIN_SECTION,
  PRIVATE_HOME_DIRS,
  SAMPLE_REPOS,
  SECTION,
  SKIPPED_DIRS,
  URL_LINE,
} from '../schema.ts';

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

      const isSkipped = (name: string) => name.startsWith('.') || SKIPPED_DIRS.has(name);

      const listChildren = (dir: string, entries: Dirent[], skipPrivate: boolean) =>
        entries
          .filter((entry) => entry.isDirectory() && !isSkipped(entry.name))
          .filter((entry) => !(skipPrivate && PRIVATE_HOME_DIRS.has(entry.name)))
          .map((entry) => join(dir, entry.name));

      const isRepo = (entries: Dirent[]) =>
        entries.some((entry) => entry.name === '.git' && (entry.isDirectory() || entry.isFile()));

      const readEntries = (path: string) =>
        Effect.tryPromise(() => readdir(path, { withFileTypes: true })).pipe(
          Effect.orElseSucceed((): Dirent[] => [])
        );

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

      const selectLocalRepo = (path: string, name: string) =>
        attempt((): LocalRepo | null => {
          const stats = statSync(path);
          if (!stats.isDirectory() || !existsSync(join(path, '.git'))) return null;
          return { path: realpathSync(path), name, touchedAt: stats.mtimeMs };
        });

      const discover = Effect.fn('RepoFolders.discover')(function* (
        home: string,
        options: DiscoveryOptions = {}
      ) {
        const maxDepth = options.maxDepth ?? MAX_DEPTH;
        const maxDirs = options.maxDirs ?? MAX_DIRS;
        const parents = new Map<string, string[]>();
        let queue = [home];
        let visited = 0;
        let truncated = false;
        for (let depth = 0; depth <= maxDepth && queue.length > 0; depth += 1) {
          const next: string[] = [];
          for (const dir of queue) {
            if (visited >= maxDirs) {
              truncated = true;
              break;
            }
            visited += 1;
            const entries = yield* readEntries(dir);
            if (dir !== home && isRepo(entries)) {
              const parent = dirname(dir);
              parents.set(parent, [...(parents.get(parent) ?? []), basename(dir)]);
              continue;
            }
            if (depth === maxDepth) continue;
            next.push(...listChildren(dir, entries, dir === home && Boolean(options.skipPrivate)));
          }
          queue = next;
        }
        const candidates = [...parents.entries()]
          .map(([path, repos]) => ({
            path,
            repoCount: repos.length,
            repos: repos.sort((a, b) => a.localeCompare(b)).slice(0, SAMPLE_REPOS),
          }))
          .sort((a, b) => b.repoCount - a.repoCount || a.path.localeCompare(b.path));
        return { candidates, truncated } satisfies Discovery;
      });

      const listLocal = Effect.fn('RepoFolders.listLocal')(function* (
        roots: readonly string[],
        limit = MAX_LOCAL_REPOS
      ) {
        const found = new Map<string, LocalRepo>();
        for (const root of roots) {
          const entries = yield* attempt(() => (statSync(root).isDirectory() ? readdirSync(root) : []));
          for (const entry of entries ?? []) {
            const repo = yield* selectLocalRepo(join(root, entry), entry);
            if (repo && !found.has(repo.path)) found.set(repo.path, repo);
          }
        }
        return [...found.values()].sort((a, b) => b.touchedAt - a.touchedAt).slice(0, limit);
      });

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
