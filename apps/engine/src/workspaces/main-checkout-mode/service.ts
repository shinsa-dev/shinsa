import { type ConfigProblem, type Repo, resolveRoundBase, type Task, type WorkspaceMode } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { Checkout } from '../../git/checkout/service.ts';
import { decodeRefName } from '../../git/ref-name.ts';
import { Remote } from '../../git/remote/service.ts';
import type { GitFailed } from '../../git/schema.ts';
import { Git } from '../../git/service.ts';
import { requireCheckout } from '../checkout.ts';
import {
  CheckoutDirty,
  CheckoutOffBranch,
  NO_BRANCH_YET,
  TaskCheckoutMissing,
  type Workspace,
  type WorkspaceCheckout,
} from '../schema.ts';
import { WorktreeWorkspaces } from '../worktrees-mode/service.ts';

export class MainCheckoutWorkspace extends Context.Service<
  MainCheckoutWorkspace,
  {
    workspace: Workspace;
    isClean(path: string, signal?: AbortSignal): Effect.Effect<boolean, GitFailed>;
    describeProblem(
      repo: Repo,
      mode: WorkspaceMode,
      holdsCheckout: boolean,
      signal?: AbortSignal
    ): Effect.Effect<ConfigProblem | null, GitFailed>;
  }
>()('shinsa/engine/workspaces/main-checkout-mode/MainCheckoutWorkspace') {
  static readonly layer = Layer.effect(
    MainCheckoutWorkspace,
    Effect.gen(function* () {
      const git = yield* Git;
      const checkout = yield* Checkout;
      const remote = yield* Remote;
      const worktrees = yield* WorktreeWorkspaces;

      const describeDirtyCheckout = (repo: Repo) =>
        `The checkout at ${repo.path} has uncommitted changes. Commit or stash them first: agents work there on a branch of their own and would take them along.`;

      const resolveCurrentBranch = Effect.fn('MainCheckout.resolveCurrentBranch')(function* (
        path: string,
        signal?: AbortSignal
      ) {
        const result = yield* git.attempt(['symbolic-ref', '--quiet', '--short', 'HEAD'], path, { signal });
        return result.ok ? result.stdout : null;
      });

      const isClean = Effect.fn('MainCheckout.isClean')(function* (path: string, signal?: AbortSignal) {
        const status = yield* git.run(['status', '--porcelain'], path, { signal });
        return status.length === 0;
      });

      const assertOnBranch = Effect.fn('MainCheckout.assertOnBranch')(function* (
        path: string,
        branch: string
      ) {
        const current = yield* resolveCurrentBranch(path);
        if (current === branch) return;
        return yield* new CheckoutOffBranch({
          branch,
          current,
          message: `The checkout is on ${current ?? 'a detached commit'}, not on the task’s branch ${branch}. Switch it back to ${branch}, then retry.`,
        });
      });

      const resolveReturnBranch = Effect.fn('MainCheckout.resolveReturnBranch')(function* (
        repo: Repo,
        task: Task
      ) {
        const branch = task.returnBranch;
        if (!branch || branch === task.branch) return repo.defaultBranch;
        const exists = yield* git.attempt(
          ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
          repo.path
        );
        if (exists.ok) return branch;
        yield* Effect.logInfo(
          '[Workspaces] The branch the checkout was on is gone, so it goes back to the default branch'
        ).pipe(Effect.annotateLogs({ taskId: task.id, branch, defaultBranch: repo.defaultBranch }));
        return repo.defaultBranch;
      });

      const describeProblem = Effect.fn('MainCheckout.describeProblem')(function* (
        repo: Repo,
        mode: WorkspaceMode,
        holdsCheckout: boolean,
        signal?: AbortSignal
      ) {
        if (mode !== 'main_checkout' || holdsCheckout) return null;
        if (yield* isClean(repo.path, signal)) return null;
        return { kind: 'workspace', detail: describeDirtyCheckout(repo) } satisfies ConfigProblem;
      });

      const prepare = Effect.fn('MainCheckout.prepare')(function* (
        repo: Repo,
        task: Task,
        signal?: AbortSignal
      ) {
        if (!task.branch) return yield* new TaskCheckoutMissing({ message: NO_BRANCH_YET });
        if (
          task.worktreePath === repo.path &&
          (yield* resolveCurrentBranch(repo.path, signal)) === task.branch
        ) {
          return { path: repo.path, branch: task.branch } satisfies WorkspaceCheckout;
        }
        if (!(yield* isClean(repo.path, signal))) {
          return yield* new CheckoutDirty({ path: repo.path, message: describeDirtyCheckout(repo) });
        }
        const wanted = yield* decodeRefName(task.branch);
        if (task.worktreePath === repo.path) {
          yield* git.run(['checkout', '--quiet', wanted, '--'], repo.path, { signal });
          return { path: repo.path, branch: task.branch } satisfies WorkspaceCheckout;
        }
        const returnBranch = yield* resolveCurrentBranch(repo.path, signal);
        const base = yield* checkout.resolveStartPoint(repo, resolveRoundBase(task), signal);
        const branch = yield* checkout.resolveFreeBranch(repo, wanted, signal);
        yield* git.run(['checkout', '--quiet', '--no-track', '-b', branch, base, '--'], repo.path, {
          signal,
        });
        return {
          path: repo.path,
          branch,
          ...(returnBranch ? { returnBranch } : {}),
        } satisfies WorkspaceCheckout;
      });

      const remove = Effect.fn('MainCheckout.remove')(function* (repo: Repo, task: Task) {
        const current = yield* resolveCurrentBranch(repo.path);
        if (current !== task.branch) return;
        if (!(yield* isClean(repo.path))) {
          yield* Effect.logWarning(
            '[Workspaces] Left the checkout on the task’s branch: it has uncommitted changes'
          ).pipe(Effect.annotateLogs({ taskId: task.id, path: repo.path }));
          return;
        }
        const back = yield* decodeRefName(yield* resolveReturnBranch(repo, task));
        yield* git.run(['checkout', '--quiet', back, '--'], repo.path);
      });

      const workspace: Workspace = {
        mode: 'main_checkout',
        prepare,
        commit: (repo, task, message) =>
          requireCheckout(task).pipe(
            Effect.tap(({ branch }) => assertOnBranch(repo.path, branch)),
            Effect.andThen(worktrees.commit(repo.path, message))
          ),
        push: Effect.fn('MainCheckout.push')(function* (repo: Repo, task: Task, signal?: AbortSignal) {
          const branch = yield* decodeRefName((yield* requireCheckout(task)).branch);
          yield* remote.push(
            ['git', 'push', '--quiet', '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`],
            repo.path,
            signal
          );
          return yield* git.run(['rev-parse', `refs/heads/${branch}`], repo.path);
        }),
        remove,
        writeEdit: (repo, task, _path, write) =>
          requireCheckout(task).pipe(
            Effect.tap(({ branch }) => assertOnBranch(repo.path, branch)),
            Effect.andThen(write),
            Effect.asVoid
          ),
        syncBase: (repo, task, base, onBehind, signal) =>
          requireCheckout(task).pipe(
            Effect.tap(({ branch }) => assertOnBranch(repo.path, branch)),
            Effect.flatMap(({ branch }) => remote.updateOntoBase(repo.path, base, branch, onBehind, signal))
          ),
      };

      return MainCheckoutWorkspace.of({ workspace, isClean, describeProblem });
    })
  );
}
