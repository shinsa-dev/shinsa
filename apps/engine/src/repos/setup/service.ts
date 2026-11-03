import { existsSync } from 'node:fs';
import type { ConfigProblem, Repo } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { decodeRefName } from '../../git/ref-name.ts';
import { Git } from '../../git/service.ts';
import { SETUP_FETCH_TIMEOUT, type SetupScope } from '../schema.ts';

export class RepoSetup extends Context.Service<
  RepoSetup,
  { verify(repo: Repo, scope: SetupScope, signal?: AbortSignal): Effect.Effect<ConfigProblem[]> }
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

      return RepoSetup.of({ verify });
    })
  );
}
