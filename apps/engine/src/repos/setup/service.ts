import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import type { ConfigProblem, Repo, RepoStart } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { decodeRefName } from '../../git/ref-name.ts';
import { Git } from '../../git/service.ts';
import {
  FALLBACK_DEFAULT_BRANCH,
  FIRST_COMMIT_MESSAGE,
  RepoNotCreated,
  SETUP_FETCH_TIMEOUT,
  SETUP_PUSH_TIMEOUT,
  type SetupScope,
  type SetupTarget,
} from '../schema.ts';

export class RepoSetup extends Context.Service<
  RepoSetup,
  {
    prepare(target: SetupTarget, signal?: AbortSignal): Effect.Effect<RepoStart | null>;
    create(path: string): Effect.Effect<RepoStart, RepoNotCreated>;
    verify(repo: Repo, scope: SetupScope, signal?: AbortSignal): Effect.Effect<ConfigProblem[]>;
  }
>()('shinsa/engine/repos/setup/RepoSetup') {
  static readonly layer = Layer.effect(
    RepoSetup,
    Effect.gen(function* () {
      const git = yield* Git;

      const isGitRepo = Effect.fn('RepoSetup.isGitRepo')(function* (path: string) {
        const result = yield* git.attempt(['rev-parse', '--is-inside-work-tree'], path);
        return result.ok && result.stdout === 'true';
      });

      const hasBranch = Effect.fn('RepoSetup.hasBranch')(function* (path: string, branch: string) {
        for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
          const result = yield* git.attempt(['rev-parse', '--verify', '--quiet', ref], path);
          if (result.ok) return true;
        }
        return false;
      });

      const hasDefaultBranch = Effect.fn('RepoSetup.hasDefaultBranch')(function* (
        repo: Repo,
        branch: string,
        signal?: AbortSignal
      ) {
        if (yield* hasBranch(repo.path, branch)) return true;
        if (!repo.remote) return false;
        yield* git.attempt(['fetch', '--quiet', 'origin', '--', branch], repo.path, {
          timeout: SETUP_FETCH_TIMEOUT,
          signal,
        });
        return yield* hasBranch(repo.path, branch);
      });

      const describeMissingDefaultBranch = Effect.fn('RepoSetup.describeMissingDefaultBranch')(function* (
        repo: Repo,
        signal?: AbortSignal
      ) {
        const decoded = yield* Effect.result(decodeRefName(repo.defaultBranch));
        if (decoded._tag === 'Failure') {
          return { kind: 'default_branch', detail: decoded.failure.message } satisfies ConfigProblem;
        }
        const branch = decoded.success;
        if (yield* hasDefaultBranch(repo, branch, signal)) return null;
        return {
          kind: 'default_branch',
          detail: `The default branch “${branch}” is not in the repository${repo.remote ? ' or on origin' : ''}.`,
        } satisfies ConfigProblem;
      });

      const verify = Effect.fn('RepoSetup.verify')(function* (
        repo: Repo,
        scope: SetupScope,
        signal?: AbortSignal
      ) {
        if (!(yield* Effect.sync(() => existsSync(repo.path)))) {
          return [
            { kind: 'repository', detail: `The folder ${repo.path} no longer exists.` },
          ] satisfies ConfigProblem[];
        }
        if (!(yield* isGitRepo(repo.path))) {
          return [
            { kind: 'repository', detail: `${repo.path} is not a git repository.` },
          ] satisfies ConfigProblem[];
        }
        const branch = scope.defaultBranch ? yield* describeMissingDefaultBranch(repo, signal) : null;
        return branch ? [branch] : [];
      });

      const isEmptyFolder = (path: string) =>
        Effect.sync(() => existsSync(path) && readdirSync(path).length === 0);

      const hasCommits = Effect.fn('RepoSetup.hasCommits')(function* (path: string) {
        const result = yield* git.attempt(['for-each-ref', '--count=1', '--format=%(refname)'], path);
        return !result.ok || result.stdout !== '';
      });

      const hasOrigin = Effect.fn('RepoSetup.hasOrigin')(function* (path: string) {
        const result = yield* git.attempt(['remote'], path);
        return result.ok && result.stdout.split('\n').includes('origin');
      });

      const isOriginEmpty = Effect.fn('RepoSetup.isOriginEmpty')(function* (
        path: string,
        signal?: AbortSignal
      ) {
        const result = yield* git.attempt(['ls-remote', '--heads', 'origin'], path, {
          timeout: SETUP_FETCH_TIMEOUT,
          signal,
        });
        return result.ok && result.stdout === '';
      });

      const startRepo = Effect.fn('RepoSetup.startRepo')(function* (
        path: string,
        branch: string,
        initialized: boolean,
        signal?: AbortSignal
      ) {
        const origin = yield* hasOrigin(path);
        if (origin && !(yield* isOriginEmpty(path, signal))) return null;
        const head = yield* git.attempt(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], path);
        if (!head.ok) return null;
        const commit = yield* git.attempt(
          ['commit', '--quiet', '--allow-empty', '--no-verify', '-m', FIRST_COMMIT_MESSAGE],
          path
        );
        if (!commit.ok) return null;
        if (!origin) return { branch, initialized, pushed: false } satisfies RepoStart;
        const push = yield* git.attempt(
          ['push', '--quiet', 'origin', `refs/heads/${branch}:refs/heads/${branch}`],
          path,
          { timeout: SETUP_PUSH_TIMEOUT, signal }
        );
        return { branch, initialized, pushed: push.ok } satisfies RepoStart;
      });

      const prepare = Effect.fn('RepoSetup.prepare')(function* (target: SetupTarget, signal?: AbortSignal) {
        const decoded = yield* Effect.result(decodeRefName(target.defaultBranch));
        if (decoded._tag === 'Failure') return null;
        const branch = decoded.success;
        if (yield* isEmptyFolder(target.path)) {
          const init = yield* git.attempt(['init', '--quiet', `--initial-branch=${branch}`], target.path);
          if (!init.ok) return null;
          return yield* startRepo(target.path, branch, true, signal);
        }
        if (!(yield* isGitRepo(target.path)) || (yield* hasCommits(target.path))) return null;
        return yield* startRepo(target.path, branch, false, signal);
      });

      const makeFolder = (path: string) =>
        Effect.try({
          try: () => {
            if (existsSync(path) && readdirSync(path).length > 0) {
              throw new Error(`${path} already exists and is not empty.`);
            }
            mkdirSync(path, { recursive: true });
          },
          catch: (error) =>
            new RepoNotCreated({ path, message: error instanceof Error ? error.message : String(error) }),
        });

      const resolveInitialBranch = Effect.fn('RepoSetup.resolveInitialBranch')(function* (path: string) {
        const configured = yield* git.attempt(['config', '--get', 'init.defaultBranch'], path);
        return configured.ok && configured.stdout ? configured.stdout : FALLBACK_DEFAULT_BRANCH;
      });

      const create = Effect.fn('RepoSetup.create')(function* (path: string) {
        yield* makeFolder(path);
        const defaultBranch = yield* resolveInitialBranch(path);
        const started = yield* prepare({ path, defaultBranch });
        if (started) return started;
        return yield* new RepoNotCreated({
          path,
          message: `Made the folder ${path}, but git could not start a repository with a first commit on “${defaultBranch}” there.`,
        });
      });

      return RepoSetup.of({ prepare, create, verify });
    })
  );
}
