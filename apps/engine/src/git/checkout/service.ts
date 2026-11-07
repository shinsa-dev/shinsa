import { dirname, join, resolve } from 'node:path';
import type { Repo } from '@shinsa/core';
import { Clock, Context, Effect, FileSystem, Layer, Option } from 'effect';
import { constFalse, constNull } from 'effect/Function';
import type { PlatformError } from 'effect/PlatformError';
import { selectInstallCommand } from '../../checks/install.ts';
import { describeError } from '../../log/redact.ts';
import { resolveCancel } from '../../shell/abort.ts';
import { describeFailure } from '../../shell/failure.ts';
import { COMMAND_TIMEOUT, type CommandResult, NOT_STARTED_EXIT_CODE } from '../../shell/schema.ts';
import { Shell } from '../../shell/service.ts';
import { decodeRefName } from '../ref-name.ts';
import { GitFailed, type RefNameInvalid } from '../schema.ts';
import { Git } from '../service.ts';
import {
  isDelegationCheckout,
  listChangedNames,
  parseWorktreeList,
  resolveDelegationFolder,
  resolveIsolatedPath,
  resolveWorktreePath,
} from './paths.ts';
import {
  BRANCH_ATTEMPTS,
  CommitInvalid,
  type CommitResult,
  COMMIT_ID,
  GIT_NETWORK_TIMEOUT,
  MergeUnresolved,
  type PendingMerge,
  REMOTE_MERGE_SUBJECT,
  type WorktreeCheckout,
} from './schema.ts';

export class Checkout extends Context.Service<
  Checkout,
  {
    commit(path: string, message: string): Effect.Effect<CommitResult | null, GitFailed | MergeUnresolved>;
    writeMergeHead(path: string, merge: PendingMerge): Effect.Effect<void, GitFailed>;
    listCommitFiles(path: string, from: string, to: string): Effect.Effect<string[], GitFailed>;
    stash(path: string, message: string): Effect.Effect<boolean, GitFailed>;
    head(path: string): Effect.Effect<string, GitFailed>;
    tree(path: string): Effect.Effect<string, GitFailed>;
    discard(path: string, signal?: AbortSignal): Effect.Effect<void, GitFailed>;
    prepare(path: string, signal?: AbortSignal): Effect.Effect<void>;
    syncRemoteBranch(
      repo: Repo,
      branch: string,
      signal?: AbortSignal
    ): Effect.Effect<CommandResult, RefNameInvalid>;
    resolveStartPoint(
      repo: Repo,
      baseBranch: string | null,
      signal?: AbortSignal
    ): Effect.Effect<string, RefNameInvalid>;
    resolveFreeBranch(
      repo: Repo,
      branch: string,
      signal?: AbortSignal,
      head?: string | null
    ): Effect.Effect<string, GitFailed>;
    create(
      repo: Repo,
      worktreesDir: string,
      taskId: string,
      branch: string,
      baseBranch: string | null,
      signal?: AbortSignal
    ): Effect.Effect<WorktreeCheckout, GitFailed | RefNameInvalid>;
    refresh(
      repo: Repo,
      path: string,
      baseBranch: string | null,
      signal?: AbortSignal
    ): Effect.Effect<void, GitFailed | RefNameInvalid>;
    mergeBranches(
      path: string,
      branch: string,
      others: readonly string[],
      signal?: AbortSignal
    ): Effect.Effect<string[], GitFailed | RefNameInvalid>;
    remove(repo: Repo, path: string): Effect.Effect<void, GitFailed>;
    createIsolated(
      repo: Repo,
      worktreesDir: string,
      taskId: string,
      runId: string,
      baseCommit: string
    ): Effect.Effect<string, GitFailed | CommitInvalid>;
    describeIsolated(path: string): Effect.Effect<number | null>;
    removeIsolated(repo: Repo, worktreesDir: string, taskId: string): Effect.Effect<void, GitFailed>;
  }
>()('shinsa/engine/git/checkout/Checkout') {
  static readonly layer = Layer.effect(
    Checkout,
    Effect.gen(function* () {
      const git = yield* Git;
      const shell = yield* Shell;
      const fs = yield* FileSystem.FileSystem;
      const withFiles = Effect.provideService(FileSystem.FileSystem, fs);
      const toGitFailed = (error: PlatformError) =>
        new GitFailed({ message: describeError(error), retryable: false });
      const isPresent = (path: string) => fs.exists(path).pipe(Effect.orElseSucceed(constFalse));
      const removeFolder = (path: string) =>
        fs.remove(path, { recursive: true, force: true }).pipe(Effect.mapError(toGitFailed));

      const resolveGitPath = (path: string, name: string) =>
        Effect.map(git.run(['rev-parse', '--git-path', name], path), (relative) => resolve(path, relative));

      const readOptional = (file: string) => fs.readFileString(file).pipe(Effect.orElseSucceed(constNull));

      const resolveMergeMessage = Effect.fnUntraced(function* (path: string, fallback: string) {
        const text = yield* readOptional(yield* resolveGitPath(path, 'MERGE_MSG'));
        const subject = text?.split('\n')[0]?.trim() ?? '';
        if (!subject) return fallback;
        return subject.replace(REMOTE_MERGE_SUBJECT, "Merge branch '$1'");
      });

      const assertMergeResolved = Effect.fnUntraced(function* (path: string) {
        const unmerged = yield* git.run(['diff', '--name-only', '--diff-filter=U'], path);
        if (!unmerged) return;
        const files = unmerged.split('\n');
        return yield* new MergeUnresolved({
          files,
          message: `The merge still has conflicts in ${files.join(', ')}. Resolve them and \`git add\` the files, then hand over again.`,
        });
      });

      const commit = Effect.fn('Checkout.commit')(function* (path: string, message: string) {
        const mergeHead = yield* readOptional(yield* resolveGitPath(path, 'MERGE_HEAD'));
        const status = yield* git.run(['status', '--porcelain'], path);
        if (status.length === 0 && mergeHead === null) return null;
        if (mergeHead !== null) yield* assertMergeResolved(path);
        yield* git.run(['add', '-A'], path);
        const merge =
          mergeHead === null ? null : { mergeHead, mergeMessage: yield* resolveMergeMessage(path, message) };
        yield* git.run(['commit', '--no-verify', '-q', '-F', '-'], path, {
          input: merge?.mergeMessage ?? message,
        });
        return { merge };
      });

      const writeMergeHead = Effect.fn('Checkout.writeMergeHead')(function* (
        path: string,
        merge: PendingMerge
      ) {
        const head = yield* resolveGitPath(path, 'MERGE_HEAD');
        yield* fs.writeFileString(head, merge.mergeHead).pipe(Effect.mapError(toGitFailed));
        const subject = yield* resolveGitPath(path, 'MERGE_MSG');
        yield* fs.writeFileString(subject, `${merge.mergeMessage}\n`).pipe(Effect.mapError(toGitFailed));
      });

      const listCommitFiles = Effect.fn('Checkout.listCommitFiles')(function* (
        path: string,
        from: string,
        to: string
      ) {
        const names = yield* git.run(
          ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', from, to],
          path
        );
        return listChangedNames(names);
      });

      const stash = Effect.fn('Checkout.stash')(function* (path: string, message: string) {
        const status = yield* git.attempt(['status', '--porcelain'], path);
        if (!status.ok || status.stdout.length === 0) return false;
        yield* git.run(['stash', 'push', '--include-untracked', '-m', message], path);
        return true;
      });

      const readHead = (path: string) => git.run(['rev-parse', 'HEAD'], path);

      const readTree = (path: string) => git.run(['rev-parse', 'HEAD^{tree}'], path);

      const discard = Effect.fn('Checkout.discard')(function* (path: string, signal?: AbortSignal) {
        yield* git.run(['reset', '--hard', '--quiet', 'HEAD'], path, { signal });
        yield* git.run(['clean', '-fdq'], path, { signal });
      });

      const runInstall = (install: string[], path: string, signal?: AbortSignal) =>
        shell
          .run({
            argv: [install[0] ?? 'true', ...install.slice(1)],
            cwd: path,
            timeout: COMMAND_TIMEOUT,
            cancel: resolveCancel(signal),
          })
          .pipe(
            Effect.catchTag('CommandNotFound', (missing) =>
              Effect.succeed<CommandResult>({
                ok: false,
                code: NOT_STARTED_EXIT_CODE,
                stdout: '',
                stderr: missing.message,
                timedOut: false,
              })
            )
          );

      const prepare = Effect.fn('Checkout.prepare')(function* (path: string, signal?: AbortSignal) {
        const selected = yield* withFiles(selectInstallCommand(path));
        if (Option.isNone(selected) || signal?.aborted) return;
        const install = selected.value;
        const first = yield* runInstall(install, path, signal);
        if (first.ok || signal?.aborted) return;
        const result = yield* runInstall(install, path, signal);
        if (result.ok || signal?.aborted) return;
        yield* Effect.logWarning('[Git] Installing dependencies failed; the agent sets them up').pipe(
          Effect.annotateLogs({ path, error: describeFailure(install, result) })
        );
      });

      const hasRef = (repo: Repo, ref: string, signal?: AbortSignal) =>
        Effect.map(
          git.attempt(['show-ref', '--verify', '--quiet', ref], repo.path, { signal }),
          (shown) => shown.ok
        );

      const listRegistered = (repo: Repo, signal?: AbortSignal) =>
        Effect.map(git.run(['worktree', 'list', '--porcelain'], repo.path, { signal }), parseWorktreeList);

      const isSamePath = Effect.fnUntraced(function* (a: string, b: string) {
        const left = yield* Effect.option(fs.realPath(a));
        const right = yield* Effect.option(fs.realPath(b));
        return Option.isSome(left) && Option.isSome(right) && left.value === right.value;
      });

      const isLeftBehind = Effect.fnUntraced(function* (
        repo: Repo,
        branch: string,
        head: string,
        signal?: AbortSignal
      ) {
        const tip = yield* git.attempt(
          ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
          repo.path,
          {
            signal,
          }
        );
        if (!tip.ok || tip.stdout !== head) return false;
        if (yield* hasRef(repo, `refs/remotes/origin/${branch}`, signal)) return false;
        const registered = yield* listRegistered(repo, signal);
        return registered.every((worktree) => worktree.branch !== branch);
      });

      const isFreeBranch = Effect.fnUntraced(function* (
        repo: Repo,
        branch: string,
        head: string | null,
        signal?: AbortSignal
      ) {
        const taken =
          (yield* hasRef(repo, `refs/heads/${branch}`, signal)) ||
          (yield* hasRef(repo, `refs/remotes/origin/${branch}`, signal));
        if (!taken) return true;
        return head !== null && (yield* isLeftBehind(repo, branch, head, signal));
      });

      const resolveFreeBranch = Effect.fn('Checkout.resolveFreeBranch')(function* (
        repo: Repo,
        branch: string,
        signal?: AbortSignal,
        head: string | null = null
      ) {
        for (let attempt = 1; attempt < BRANCH_ATTEMPTS; attempt += 1) {
          const candidate = attempt === 1 ? branch : `${branch}-${attempt}`;
          if (yield* isFreeBranch(repo, candidate, head, signal)) return candidate;
        }
        return `${branch}-${yield* Clock.currentTimeMillis}`;
      });

      const syncRemoteBranch = Effect.fn('Checkout.syncRemoteBranch')(function* (
        repo: Repo,
        branch: string,
        signal?: AbortSignal
      ) {
        const name = yield* decodeRefName(branch);
        return yield* git.attempt(['fetch', '--quiet', 'origin', '--', name], repo.path, {
          timeout: GIT_NETWORK_TIMEOUT,
          signal,
        });
      });

      const readRef = (repo: Repo, ref: string, signal?: AbortSignal) =>
        Effect.map(git.attempt(['rev-parse', '--verify', '--quiet', ref], repo.path, { signal }), (read) =>
          read.ok ? read.stdout.trim() : null
        );

      const isCheckedOut = Effect.fnUntraced(function* (repo: Repo, branch: string, signal?: AbortSignal) {
        const listed = yield* git.attempt(['worktree', 'list', '--porcelain'], repo.path, { signal });
        if (!listed.ok) return true;
        return parseWorktreeList(listed.stdout).some((worktree) => worktree.branch === branch);
      });

      const advanceLocalBranch = Effect.fnUntraced(function* (
        repo: Repo,
        branch: string,
        signal?: AbortSignal
      ) {
        const local = yield* readRef(repo, `refs/heads/${branch}`, signal);
        const remote = yield* readRef(repo, `refs/remotes/origin/${branch}`, signal);
        if (!local || !remote || local === remote) return;
        if (yield* isCheckedOut(repo, branch, signal)) return;
        const behind = yield* git.attempt(['merge-base', '--is-ancestor', local, remote], repo.path, {
          signal,
        });
        if (!behind.ok) return;
        yield* git.attempt(['update-ref', `refs/heads/${branch}`, remote, local], repo.path, { signal });
      });

      const resolveStartPoint = Effect.fn('Checkout.resolveStartPoint')(function* (
        repo: Repo,
        baseBranch: string | null,
        signal?: AbortSignal
      ) {
        if (baseBranch) return yield* decodeRefName(baseBranch);
        const branch = yield* decodeRefName(repo.defaultBranch);
        const fetched = yield* syncRemoteBranch(repo, branch, signal);
        if (fetched.ok) yield* advanceLocalBranch(repo, branch, signal);
        else {
          yield* Effect.logWarning(
            '[Git] Could not fetch the default branch; starting from the last known one'
          ).pipe(Effect.annotateLogs({ repo: repo.path, branch, error: fetched.stderr.trim() }));
        }
        const remoteBase = yield* git.attempt(
          ['rev-parse', '--verify', '--quiet', `origin/${branch}`],
          repo.path,
          {
            signal,
          }
        );
        return remoteBase.ok ? `origin/${branch}` : branch;
      });

      const nameWorktree = Effect.fnUntraced(function* (
        repo: Repo,
        path: string,
        branch: string,
        signal?: AbortSignal
      ) {
        const tip = yield* git.run(['rev-parse', 'HEAD'], path, { signal });
        const name = yield* resolveFreeBranch(repo, branch, signal, tip);
        yield* git.run(['checkout', '--quiet', '-B', name], path, { signal });
        return name;
      });

      const create = Effect.fn('Checkout.create')(function* (
        repo: Repo,
        worktreesDir: string,
        taskId: string,
        branch: string,
        baseBranch: string | null,
        signal?: AbortSignal
      ) {
        const path = resolveWorktreePath(repo, worktreesDir, taskId, yield* decodeRefName(branch));
        const worktrees = yield* listRegistered(repo, signal);
        const registered = yield* Effect.findFirst(worktrees, (worktree) => isSamePath(worktree.path, path));
        if (registered._tag === 'Some' && registered.value.branch) {
          yield* prepare(path, signal);
          return { path, branch: registered.value.branch };
        }
        if (registered._tag === 'None') {
          yield* removeFolder(path);
          yield* git.attempt(['worktree', 'prune'], repo.path, { signal });
          const base = yield* resolveStartPoint(repo, baseBranch, signal);
          yield* git.run(['worktree', 'add', '--detach', path, base], repo.path, { signal });
        }
        const named = yield* nameWorktree(repo, path, branch, signal);
        yield* prepare(path, signal);
        return { path, branch: named };
      });

      const refresh = Effect.fn('Checkout.refresh')(function* (
        repo: Repo,
        path: string,
        baseBranch: string | null,
        signal?: AbortSignal
      ) {
        const base = yield* resolveStartPoint(repo, baseBranch, signal);
        yield* git.run(['reset', '--hard', '--quiet', base], path, { signal });
        yield* git.run(['clean', '-fdq'], path, { signal });
        yield* prepare(path, signal);
      });

      const mergeBranches = Effect.fn('Checkout.mergeBranches')(function* (
        path: string,
        branch: string,
        others: readonly string[],
        signal?: AbortSignal
      ) {
        const merged: string[] = [];
        for (const other of others) {
          const name = yield* decodeRefName(other);
          const message = `Merge branch '${name}' into ${branch}`;
          const result = yield* git.attempt(['merge', '--quiet', '--no-edit', '-m', message, name], path, {
            signal,
          });
          if (result.ok) {
            merged.push(name);
            continue;
          }
          const merging = yield* git.attempt(['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'], path, {
            signal,
          });
          if (merging.ok) yield* git.run(['merge', '--abort'], path, { signal });
        }
        return merged;
      });

      const remove = Effect.fn('Checkout.remove')(function* (repo: Repo, path: string) {
        if (yield* isPresent(path)) {
          yield* git.attempt(['worktree', 'remove', '--force', path], repo.path);
        }
        yield* removeFolder(path);
        yield* git.attempt(['worktree', 'prune'], repo.path);
      });

      const isRegistered = Effect.fnUntraced(function* (repo: Repo, path: string) {
        const worktrees = yield* listRegistered(repo);
        const found = yield* Effect.findFirst(worktrees, (worktree) => isSamePath(worktree.path, path));
        return found._tag === 'Some';
      });

      const createIsolated = Effect.fn('Checkout.createIsolated')(function* (
        repo: Repo,
        worktreesDir: string,
        taskId: string,
        runId: string,
        baseCommit: string
      ) {
        if (!COMMIT_ID.test(baseCommit)) {
          return yield* new CommitInvalid({
            commit: baseCommit,
            message: `"${baseCommit}" is not a commit Shinsa will pass to git.`,
          });
        }
        const path = resolveIsolatedPath(worktreesDir, taskId, runId);
        if ((yield* isPresent(path)) && (yield* isRegistered(repo, path))) return path;
        yield* removeFolder(path);
        yield* git.attempt(['worktree', 'prune'], repo.path);
        yield* git.run(['worktree', 'add', '--detach', path, baseCommit], repo.path);
        yield* prepare(path);
        return path;
      });

      const describeIsolated = Effect.fn('Checkout.describeIsolated')(function* (path: string) {
        const status = yield* git.attempt(['status', '--porcelain'], path);
        if (!status.ok) return null;
        return status.stdout.split('\n').filter((line) => line.trim().length > 0).length;
      });

      const listDelegationCheckouts = Effect.fnUntraced(function* (repo: Repo, taskId: string) {
        const listed = yield* git.attempt(['worktree', 'list', '--porcelain'], repo.path);
        if (!listed.ok) return [];
        return parseWorktreeList(listed.stdout)
          .map((worktree) => worktree.path)
          .filter((path) => isDelegationCheckout(path, taskId));
      });

      const removeIsolated = Effect.fn('Checkout.removeIsolated')(function* (
        repo: Repo,
        worktreesDir: string,
        taskId: string
      ) {
        const folder = resolveDelegationFolder(worktreesDir, taskId);
        const registered = yield* listDelegationCheckouts(repo, taskId);
        const present = yield* isPresent(folder);
        const loose = present
          ? (yield* fs.readDirectory(folder).pipe(Effect.mapError(toGitFailed))).map((entry) =>
              join(folder, entry)
            )
          : [];
        const paths = [...new Set([...registered, ...loose])];
        if (paths.length === 0 && !present) return;
        for (const path of paths) {
          const removed = yield* git.attempt(['worktree', 'remove', '--force', path], repo.path);
          if (!removed.ok) {
            yield* Effect.logWarning(
              '[Git] Could not remove a delegation’s checkout; deleting the folder'
            ).pipe(Effect.annotateLogs({ path, error: removed.stderr.trim() }));
          }
        }
        const folders = new Set([folder, ...registered.map((path) => dirname(path))]);
        for (const each of folders) yield* removeFolder(each);
        yield* git.attempt(['worktree', 'prune'], repo.path);
      });

      return Checkout.of({
        commit,
        writeMergeHead,
        listCommitFiles,
        stash,
        head: readHead,
        tree: readTree,
        discard,
        prepare,
        syncRemoteBranch,
        resolveStartPoint,
        resolveFreeBranch,
        create,
        refresh,
        mergeBranches,
        remove,
        createIsolated,
        describeIsolated,
        removeIsolated,
      });
    })
  );
}
