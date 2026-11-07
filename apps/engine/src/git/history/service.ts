import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DIFF_PATCH_LIMITS,
  type DiffFile,
  mergeDiffPatches,
  parseDiffSummary,
  parseUnifiedDiff,
  type RefCommit,
  type Repo,
  resolveRoundBases,
  selectPatchedFiles,
  type Task,
  type TaskRefs,
} from '@shinsa/core';
import { Context, Effect, FileSystem, Layer, Option } from 'effect';
import type { CommandEnv } from '../../shell/schema.ts';
import type { GitFailed } from '../schema.ts';
import { Git } from '../service.ts';
import { decodeText } from '../text.ts';
import { selectTaskCheckout } from './checkout.ts';
import {
  ChangesUnreadable,
  CODE_UNAVAILABLE_MESSAGE,
  CodeUnavailable,
  COMBINED_BASE_ENV,
  COMBINED_BASE_MESSAGE,
  COMMIT_FIELD,
  DIFF_ARGS,
  DIFF_BYTES,
  DIFF_TIMEOUT,
  DIFF_TOO_LARGE_MESSAGE,
  DiffFailed,
  type DiffSource,
  MAX_COMMITS,
  NAMED_LIMITS,
  SCRATCH_PREFIX,
} from './schema.ts';

export class History extends Context.Service<
  History,
  {
    taskRefs(
      repo: Repo,
      task: Task,
      baseBranch: string | null,
      signal?: AbortSignal
    ): Effect.Effect<TaskRefs, CodeUnavailable>;
    changedFiles(
      repo: Repo,
      task: Task,
      baseBranch: string | null,
      signal?: AbortSignal
    ): Effect.Effect<string[], ChangesUnreadable>;
    commitDiff(
      repoPath: string,
      base: string,
      head: string,
      signal?: AbortSignal,
      paths?: readonly string[] | null
    ): Effect.Effect<DiffFile[], DiffFailed>;
    workingDiff(
      worktree: string,
      base: string,
      paths?: readonly string[] | null,
      signal?: AbortSignal
    ): Effect.Effect<DiffFile[], DiffFailed | GitFailed>;
    changedLinesPatch(
      worktree: string,
      base: string,
      signal?: AbortSignal,
      paths?: readonly string[]
    ): Effect.Effect<string, DiffFailed | GitFailed>;
    workingPatch(
      worktree: string,
      base: string,
      signal?: AbortSignal
    ): Effect.Effect<string, DiffFailed | GitFailed>;
  }
>()('shinsa/engine/git/history/History') {
  static readonly layer = Layer.effect(
    History,
    Effect.gen(function* () {
      const git = yield* Git;
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
      const selectCheckout = (task: Task) =>
        Effect.map(withFiles(selectTaskCheckout(task)), Option.getOrNull);

      const resolveCommit = Effect.fnUntraced(function* (cwd: string, ref: string, signal?: AbortSignal) {
        const read = yield* git.read(
          ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
          cwd,
          {
            signal,
          }
        );
        return read.ok ? decodeText(read.bytes).trim() : null;
      });

      const resolveFirstCommit = Effect.fnUntraced(function* (
        cwd: string,
        refs: readonly (string | null | undefined)[],
        signal?: AbortSignal
      ) {
        for (const ref of refs) {
          if (!ref) continue;
          const sha = yield* resolveCommit(cwd, ref, signal);
          if (sha) return sha;
        }
        return null;
      });

      const listDefaultRefs = (repo: Repo) => [
        `refs/remotes/origin/${repo.defaultBranch}`,
        `refs/heads/${repo.defaultBranch}`,
      ];

      const resolveMergeBase = Effect.fnUntraced(function* (
        cwd: string,
        a: string,
        b: string,
        signal?: AbortSignal
      ) {
        const read = yield* git.read(['merge-base', a, b], cwd, { signal });
        return read.ok ? decodeText(read.bytes).trim() : null;
      });

      const resolveMergedBase = Effect.fnUntraced(function* (
        cwd: string,
        head: string,
        target: string,
        signal?: AbortSignal
      ) {
        const read = yield* git.read(
          ['rev-list', '--first-parent', '--ancestry-path', '--reverse', `${head}..${target}`],
          cwd,
          { signal }
        );
        const merge = decodeText(read.bytes).split('\n')[0]?.trim();
        if (!read.ok || !merge) return head;
        const before = yield* resolveCommit(cwd, `${merge}^1`, signal);
        return (before && (yield* resolveMergeBase(cwd, head, before, signal))) ?? head;
      });

      const listBranchRefs = (branch: string) => [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`];

      const isAncestor = Effect.fnUntraced(function* (
        cwd: string,
        a: string,
        b: string,
        signal?: AbortSignal
      ) {
        const read = yield* git.read(['merge-base', '--is-ancestor', a, b], cwd, { signal });
        return read.ok;
      });

      const combineCommits = Effect.fnUntraced(function* (
        cwd: string,
        a: string,
        b: string,
        signal?: AbortSignal
      ) {
        if (yield* isAncestor(cwd, b, a, signal)) return a;
        if (yield* isAncestor(cwd, a, b, signal)) return b;
        const merged = yield* git.read(['merge-tree', '--write-tree', a, b], cwd, { signal });
        if (!merged.ok) return null;
        const tree = decodeText(merged.bytes).trim().split('\n')[0] ?? '';
        const commit = yield* git.read(
          ['commit-tree', tree, '-p', a, '-p', b, '-m', COMBINED_BASE_MESSAGE],
          cwd,
          {
            signal,
            env: COMBINED_BASE_ENV,
          }
        );
        return commit.ok ? decodeText(commit.bytes).trim() : null;
      });

      const resolveCombinedBase = Effect.fnUntraced(function* (
        repo: Repo,
        head: string,
        branches: readonly string[],
        signal?: AbortSignal
      ) {
        let combined: string | null = null;
        for (const branch of branches) {
          const target = yield* resolveFirstCommit(repo.path, listBranchRefs(branch), signal);
          const base = target && (yield* resolveMergeBase(repo.path, head, target, signal));
          if (!base) return null;
          combined = combined === null ? base : yield* combineCommits(repo.path, combined, base, signal);
          if (combined === null) return null;
        }
        return combined;
      });

      const resolveBase = Effect.fnUntraced(function* (
        repo: Repo,
        task: Task,
        head: string,
        baseBranch: string | null,
        signal?: AbortSignal
      ) {
        if (!task.branch) return null;
        const bases = resolveRoundBases(task);
        if (baseBranch && bases.length > 1 && bases[0] === baseBranch) {
          const combined = yield* resolveCombinedBase(repo, head, bases, signal);
          if (combined && combined !== head) return combined;
        }
        const stacked = baseBranch ? listBranchRefs(baseBranch) : [];
        const target = yield* resolveFirstCommit(repo.path, [...stacked, ...listDefaultRefs(repo)], signal);
        if (!target) return null;
        const base = yield* resolveMergeBase(repo.path, head, target, signal);
        if (base !== head) return base;
        return yield* resolveMergedBase(repo.path, head, target, signal);
      });

      const listCommits = Effect.fnUntraced(function* (
        cwd: string,
        base: string | null,
        head: string,
        signal?: AbortSignal
      ) {
        if (!base || base === head) return [];
        const read = yield* git.read(
          [
            'log',
            '-z',
            '--reverse',
            `--max-count=${MAX_COMMITS}`,
            `--format=%H${COMMIT_FIELD}%ct${COMMIT_FIELD}%s`,
            `${base}..${head}`,
          ],
          cwd,
          { signal }
        );
        return decodeText(read.bytes)
          .split('\0')
          .filter(Boolean)
          .map((record): RefCommit => {
            const [sha = '', at = '0', subject = ''] = record.split(COMMIT_FIELD);
            return { sha, at: Number(at) * 1000, subject };
          });
      });

      const isDirty = Effect.fnUntraced(function* (worktree: string | null, signal?: AbortSignal) {
        if (!worktree) return false;
        const read = yield* git.read(['status', '--porcelain', '-z'], worktree, { signal });
        return read.ok && read.bytes.length > 0;
      });

      const resolveHead = (repo: Repo, task: Task, worktree: string | null, signal?: AbortSignal) => {
        if (worktree) return resolveCommit(worktree, 'HEAD', signal);
        const refs = task.branch
          ? [
              `refs/heads/${task.branch}`,
              task.pullRequest?.headSha,
              task.pushedSha,
              `refs/remotes/origin/${task.branch}`,
            ]
          : [...listDefaultRefs(repo), 'HEAD'];
        return resolveFirstCommit(repo.path, refs, signal);
      };

      const taskRefs = Effect.fn('History.taskRefs')(function* (
        repo: Repo,
        task: Task,
        baseBranch: string | null,
        signal?: AbortSignal
      ) {
        const worktree = yield* selectCheckout(task);
        const head = yield* resolveHead(repo, task, worktree, signal);
        if (!head) return yield* new CodeUnavailable({ message: CODE_UNAVAILABLE_MESSAGE });
        const base = yield* resolveBase(repo, task, head, baseBranch, signal);
        const dirty = yield* isDirty(worktree, signal);
        return {
          head,
          base,
          branch: task.branch,
          defaultBranch: repo.defaultBranch,
          working: worktree !== null,
          dirty,
          commits: yield* listCommits(repo.path, base, head, signal),
        } satisfies TaskRefs;
      });

      const splitPaths = (bytes: Uint8Array) => decodeText(bytes).split('\0').filter(Boolean);

      const listCommittedFiles = Effect.fnUntraced(function* (
        repo: Repo,
        task: Task,
        baseBranch: string | null,
        signal?: AbortSignal
      ) {
        const refs = yield* taskRefs(repo, task, baseBranch, signal).pipe(
          Effect.catchTag('CodeUnavailable', () => Effect.succeed(null))
        );
        if (!refs?.base || refs.base === refs.head) return [];
        const read = yield* git.read(
          ['diff', '--name-only', '-z', '--no-renames', refs.base, refs.head, '--'],
          repo.path,
          {
            signal,
          }
        );
        if (!read.ok) return yield* new ChangesUnreadable({ message: read.stderr || 'git diff failed.' });
        return splitPaths(read.bytes);
      });

      const listUncommittedFiles = Effect.fnUntraced(function* (
        checkout: string | null,
        signal?: AbortSignal
      ) {
        if (!checkout) return [];
        const read = yield* git.read(
          ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'],
          checkout,
          {
            signal,
          }
        );
        if (!read.ok) return yield* new ChangesUnreadable({ message: read.stderr || 'git status failed.' });
        return splitPaths(read.bytes).map((entry) => entry.slice(3));
      });

      const changedFiles = Effect.fn('History.changedFiles')(function* (
        repo: Repo,
        task: Task,
        baseBranch: string | null,
        signal?: AbortSignal
      ) {
        const committed = yield* listCommittedFiles(repo, task, baseBranch, signal);
        const uncommitted = yield* listUncommittedFiles(yield* selectCheckout(task), signal);
        return [...new Set([...committed, ...uncommitted])].sort();
      });

      const readDiffText = Effect.fnUntraced(function* (
        source: DiffSource,
        args: readonly string[],
        paths: readonly string[]
      ) {
        const read = yield* git.read([...DIFF_ARGS, ...args, ...source.range, '--', ...paths], source.cwd, {
          signal: source.signal,
          maxBytes: DIFF_BYTES,
          timeout: DIFF_TIMEOUT,
          env: source.env,
        });
        if (!read.ok || read.truncated)
          return yield* new DiffFailed({ message: read.stderr || DIFF_TOO_LARGE_MESSAGE });
        return decodeText(read.bytes);
      });

      const readDiff = Effect.fnUntraced(function* (source: DiffSource, paths: readonly string[] | null) {
        if (paths?.length === 0) return [];
        const summary = parseDiffSummary(
          yield* readDiffText(source, ['--raw', '--numstat', '-z'], paths ?? [])
        );
        const chosen = paths ? summary.filter((file) => !file.binary) : selectPatchedFiles(summary);
        if (chosen.length === 0) return mergeDiffPatches(summary, []);
        const patchPaths = chosen.flatMap((file) =>
          file.previousPath ? [file.previousPath, file.path] : [file.path]
        );
        const patched = parseUnifiedDiff(yield* readDiffText(source, [], patchPaths));
        return mergeDiffPatches(summary, patched, paths ? NAMED_LIMITS : DIFF_PATCH_LIMITS);
      });

      const commitDiff = Effect.fn('History.commitDiff')(function* (
        repoPath: string,
        base: string,
        head: string,
        signal?: AbortSignal,
        paths: readonly string[] | null = null
      ) {
        return yield* readDiff({ cwd: repoPath, range: [base, head], signal }, paths);
      });

      const withScratchIndex = <A, E>(worktree: string, read: (env: CommandEnv) => Effect.Effect<A, E>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const index = yield* git.run(
              ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
              worktree
            );
            const scratch = yield* Effect.acquireRelease(
              Effect.sync(() => mkdtempSync(join(tmpdir(), SCRATCH_PREFIX))),
              (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true }))
            );
            const file = join(scratch, 'index');
            yield* Effect.sync(() => {
              if (!existsSync(index)) return;
              copyFileSync(index, file);
              const { atime, mtime } = statSync(index);
              utimesSync(file, atime, mtime);
            });
            const env = { GIT_INDEX_FILE: file };
            yield* git.run(['add', '-A', '--intent-to-add'], worktree, { env });
            return yield* read(env);
          })
        );

      const workingDiff = Effect.fn('History.workingDiff')(function* (
        worktree: string,
        base: string,
        paths: readonly string[] | null = null,
        signal?: AbortSignal
      ) {
        return yield* withScratchIndex(worktree, (env) =>
          readDiff({ cwd: worktree, range: [base], env, signal }, paths)
        );
      });

      const changedLinesPatch = Effect.fn('History.changedLinesPatch')(function* (
        worktree: string,
        base: string,
        signal?: AbortSignal,
        paths: readonly string[] = []
      ) {
        return yield* withScratchIndex(worktree, (env) =>
          readDiffText({ cwd: worktree, range: [base], env, signal }, ['-U0'], paths)
        );
      });

      const workingPatch = Effect.fn('History.workingPatch')(function* (
        worktree: string,
        base: string,
        signal?: AbortSignal
      ) {
        return yield* withScratchIndex(worktree, (env) =>
          readDiffText({ cwd: worktree, range: [base], env, signal }, [], [])
        );
      });

      return History.of({ taskRefs, changedFiles, commitDiff, workingDiff, changedLinesPatch, workingPatch });
    })
  );
}
