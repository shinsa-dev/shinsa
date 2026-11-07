import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { BundleConflict, Repo, RepoCandidate } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { resolveAuthorEnv, resolveGitTokenEnv } from '../../github/identity/resolve.ts';
import { TaskGitHub } from '../../github/identity/schema.ts';
import { describeFailure } from '../../shell/failure.ts';
import { decodeRefName } from '../ref-name.ts';
import { GitFailed, type RefNameInvalid } from '../schema.ts';
import { Git } from '../service.ts';
import { createPushError, normalizeRemote } from './output.ts';
import {
  type BaseUpdate,
  type BundleBranch,
  FETCH_TIMEOUT,
  LOCAL_DEFAULTS,
  MISSING_REMOTE_REF,
  type PushError,
  TRIAL_IDENTITY,
} from './schema.ts';

export class Remote extends Context.Service<
  Remote,
  {
    hasPrePushHook(cwd: string, signal?: AbortSignal): Effect.Effect<boolean>;
    push(argv: readonly string[], cwd: string, signal?: AbortSignal): Effect.Effect<void, PushError>;
    pushBranch(
      path: string,
      branch: string,
      signal?: AbortSignal
    ): Effect.Effect<void, PushError | RefNameInvalid>;
    updateOntoBase(
      path: string,
      base: string,
      branch: string,
      onBehind: Effect.Effect<void>,
      signal?: AbortSignal
    ): Effect.Effect<BaseUpdate, PushError | GitFailed | RefNameInvalid>;
    checkBundleMerge(
      repo: Repo,
      members: readonly BundleBranch[],
      signal?: AbortSignal
    ): Effect.Effect<BundleConflict | null, GitFailed | RefNameInvalid>;
    resolveRoot(path: string): Effect.Effect<string | null>;
    resolveOrigin(root: string): Effect.Effect<string | null>;
    inspect(path: string): Effect.Effect<RepoCandidate, GitFailed>;
  }
>()('shinsa/engine/git/remote/Remote') {
  static readonly layer = Layer.effect(
    Remote,
    Effect.gen(function* () {
      const git = yield* Git;

      const hasPrePushHook = Effect.fn('Remote.hasPrePushHook')(function* (
        cwd: string,
        signal?: AbortSignal
      ) {
        const result = yield* git.attempt(['rev-parse', '--git-path', 'hooks/pre-push'], cwd, { signal });
        if (!result.ok) return false;
        const path = resolve(cwd, result.stdout);
        return yield* Effect.sync(() => {
          if (!existsSync(path) || (statSync(path).mode & 0o111) === 0) return false;
          const folder = dirname(path);
          return basename(folder) !== '_' || existsSync(join(dirname(folder), 'pre-push'));
        });
      });

      const push = Effect.fn('Remote.push')(function* (
        argv: readonly string[],
        cwd: string,
        signal?: AbortSignal
      ) {
        const { identity } = yield* TaskGitHub;
        const env = resolveGitTokenEnv(identity);
        const result = yield* git.attempt(argv.slice(1), cwd, { timeout: null, signal, env });
        if (result.ok) return;
        return yield* createPushError(argv, result, yield* hasPrePushHook(cwd));
      });

      const pushBranch = Effect.fn('Remote.pushBranch')(function* (
        path: string,
        branch: string,
        signal?: AbortSignal
      ) {
        const ref = `HEAD:refs/heads/${yield* decodeRefName(branch)}`;
        yield* push(['git', 'push', '--quiet', '-u', 'origin', ref], path, signal);
      });

      const syncBaseRef = Effect.fnUntraced(function* (path: string, base: string, signal?: AbortSignal) {
        const branch = yield* decodeRefName(base);
        const ref = `refs/remotes/origin/${branch}`;
        const args = ['fetch', '--quiet', 'origin', '--', `+refs/heads/${branch}:${ref}`];
        const env = resolveGitTokenEnv((yield* TaskGitHub).identity);
        const result = yield* git.attempt(args, path, { timeout: FETCH_TIMEOUT, signal, env });
        if (result.ok) return ref;
        if (MISSING_REMOTE_REF.test(result.stderr)) return null;
        return yield* createPushError(['git', ...args], result, false);
      });

      const isBehind = Effect.fnUntraced(function* (path: string, ref: string, signal?: AbortSignal) {
        const args = ['merge-base', '--is-ancestor', ref, 'HEAD'];
        const result = yield* git.attempt(args, path, { signal });
        if (result.code === 0 || result.code === 1) return result.code === 1;
        return yield* new GitFailed({ message: describeFailure(['git', ...args], result), retryable: false });
      });

      const mergeBase = Effect.fnUntraced(function* (path: string, ref: string, message: string) {
        const args = ['merge', '--quiet', '--no-edit', '-m', message, ref];
        const env = resolveAuthorEnv((yield* TaskGitHub).identity);
        const result = yield* git.attempt(args, path, { env });
        if (result.ok) return { status: 'merged' } satisfies BaseUpdate;
        const unmerged = yield* git.run(
          ['-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=U'],
          path
        );
        const merging = yield* git.attempt(['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'], path);
        if (merging.ok) yield* git.run(['merge', '--abort'], path);
        const files = unmerged.split('\n').filter((file) => file.length > 0);
        if (files.length > 0) return { status: 'conflicted', files } satisfies BaseUpdate;
        return yield* new GitFailed({ message: describeFailure(['git', ...args], result), retryable: false });
      });

      const updateOntoBase = Effect.fn('Remote.updateOntoBase')(function* (
        path: string,
        base: string,
        branch: string,
        onBehind: Effect.Effect<void>,
        signal?: AbortSignal
      ) {
        const ref = yield* syncBaseRef(path, base, signal);
        if (!ref || !(yield* isBehind(path, ref, signal))) return { status: 'current' } satisfies BaseUpdate;
        yield* onBehind;
        return yield* mergeBase(path, ref, `Merge branch '${base}' into ${branch}`);
      });

      const runTrial = (repo: Repo, args: readonly string[], signal?: AbortSignal) =>
        Effect.map(git.run(args, repo.path, { signal, env: TRIAL_IDENTITY }), (out) => out.trim());

      const syncBundleRefs = Effect.fnUntraced(function* (
        repo: Repo,
        branches: string[],
        signal?: AbortSignal
      ) {
        const refs = yield* Effect.forEach([...new Set(branches)], (branch) =>
          Effect.map(decodeRefName(branch), (name) => `+refs/heads/${name}:refs/remotes/origin/${name}`)
        );
        const args = ['fetch', '--quiet', 'origin', '--', ...refs];
        const env = resolveGitTokenEnv((yield* TaskGitHub).identity);
        const result = yield* git.attempt(args, repo.path, { timeout: FETCH_TIMEOUT, signal, env });
        if (!result.ok) {
          return yield* new GitFailed({
            message: describeFailure(['git', ...args], result),
            retryable: false,
          });
        }
      });

      const isMissing = (repo: Repo, base: string, branch: string, signal?: AbortSignal) =>
        Effect.map(
          git.attempt(['merge-base', '--is-ancestor', `origin/${base}`, `origin/${branch}`], repo.path, {
            signal,
          }),
          (result) => !result.ok
        );

      const selectBehind = Effect.fnUntraced(function* (
        repo: Repo,
        members: readonly BundleBranch[],
        signal?: AbortSignal
      ) {
        const pairs = members.flatMap((member) => member.bases.map((base) => ({ member, base })));
        const behind = yield* Effect.forEach(
          pairs,
          ({ member, base }) => isMissing(repo, base, member.branch, signal),
          {
            concurrency: 'unbounded',
          }
        );
        return pairs.find((_, index) => behind[index]) ?? null;
      });

      const mergeTrial = Effect.fnUntraced(function* (
        repo: Repo,
        onto: string,
        branch: string,
        signal?: AbortSignal
      ) {
        const args = ['merge-tree', '--write-tree', onto, branch];
        const result = yield* git.attempt(args, repo.path, { signal });
        if (result.code === 1) return null;
        if (!result.ok) {
          return yield* new GitFailed({
            message: describeFailure(['git', ...args], result),
            retryable: false,
          });
        }
        const tree = result.stdout.trim().split('\n')[0] ?? '';
        return yield* runTrial(
          repo,
          ['commit-tree', tree, '-p', onto, '-p', branch, '-m', 'Shinsa bundle check'],
          signal
        );
      });

      const checkBundleMerge = Effect.fn('Remote.checkBundleMerge')(function* (
        repo: Repo,
        members: readonly BundleBranch[],
        signal?: AbortSignal
      ) {
        const target = yield* decodeRefName(repo.defaultBranch);
        yield* syncBundleRefs(
          repo,
          [target, ...members.flatMap((member) => [...member.bases, member.branch])],
          signal
        );
        let merged = yield* runTrial(repo, ['rev-parse', `origin/${target}`], signal);
        for (const [index, member] of members.entries()) {
          const next = yield* mergeTrial(repo, merged, `origin/${member.branch}`, signal);
          if (next === null) {
            const behind = yield* selectBehind(repo, members.slice(0, index + 1), signal);
            return {
              taskId: member.taskId,
              behindTaskId: behind?.member.taskId ?? null,
              base: behind?.base ?? target,
            };
          }
          merged = next;
        }
        return null;
      });

      const resolveRoot = Effect.fn('Remote.resolveRoot')(function* (path: string) {
        const result = yield* git.attempt(['rev-parse', '--show-toplevel'], path);
        return result.ok ? result.stdout : null;
      });

      const resolveOrigin = Effect.fn('Remote.resolveOrigin')(function* (root: string) {
        const result = yield* git.attempt(['remote', 'get-url', 'origin'], root);
        return result.ok ? normalizeRemote(result.stdout) : null;
      });

      const resolveLocalDefault = Effect.fnUntraced(function* (root: string) {
        for (const candidate of LOCAL_DEFAULTS) {
          const exists = yield* git.attempt(
            ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`],
            root
          );
          if (exists.ok) return candidate;
        }
        return yield* git.run(['branch', '--show-current'], root);
      });

      const inspect = Effect.fn('Remote.inspect')(function* (path: string) {
        const root = yield* git.run(['rev-parse', '--show-toplevel'], path);
        const remote = yield* resolveOrigin(root);
        const remoteHead = yield* git.attempt(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root);
        const defaultBranch = remoteHead.ok
          ? remoteHead.stdout.replace(/^origin\//, '')
          : yield* resolveLocalDefault(root);
        return { path: root, name: basename(root), defaultBranch, remote };
      });

      return Remote.of({
        hasPrePushHook,
        push,
        pushBranch,
        updateOntoBase,
        checkBundleMerge,
        resolveRoot,
        resolveOrigin,
        inspect,
      });
    })
  );
}
