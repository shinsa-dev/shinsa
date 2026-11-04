import { existsSync } from 'node:fs';
import { isLaterRound, type Repo, resolveRoundBases, type Task } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { MergeUnresolved } from '../../git/checkout/schema.ts';
import { Checkout } from '../../git/checkout/service.ts';
import { Remote } from '../../git/remote/service.ts';
import type { GitFailed } from '../../git/schema.ts';
import { Git } from '../../git/service.ts';
import { requireCheckout } from '../checkout.ts';
import type { WorktreeRoot } from '../root/service.ts';
import { type CheckoutCommit, NO_BRANCH_YET, TaskCheckoutMissing, type Workspace } from '../schema.ts';

export class WorktreeWorkspaces extends Context.Service<
  WorktreeWorkspaces,
  {
    make(root: WorktreeRoot['Service']): Workspace;
    commit(path: string, message: string): Effect.Effect<CheckoutCommit, GitFailed | MergeUnresolved>;
  }
>()('shinsa/engine/workspaces/worktrees-mode/WorktreeWorkspaces') {
  static readonly layer = Layer.effect(
    WorktreeWorkspaces,
    Effect.gen(function* () {
      const git = yield* Git;
      const checkout = yield* Checkout;
      const remote = yield* Remote;

      const commit = Effect.fn('WorktreeWorkspaces.commit')(function* (path: string, message: string) {
        const before = yield* checkout.head(path);
        const committed = yield* checkout.commit(path, message);
        const undo = committed
          ? git
              .run(['reset', '--soft', before], path)
              .pipe(
                Effect.andThen(committed.merge ? checkout.writeMergeHead(path, committed.merge) : Effect.void)
              )
          : Effect.void;
        return {
          treeHash: yield* checkout.tree(path),
          files: yield* checkout.listCommitFiles(path, before, 'HEAD'),
          undo,
        } satisfies CheckoutCommit;
      });

      const logBaseUnreached = (taskId: string, base: string, error: string) =>
        Effect.logWarning(
          '[Workspaces] Could not take in the latest base; the round starts from the branch'
        ).pipe(Effect.annotateLogs({ taskId, base, error }));

      const mergeLatestBase = Effect.fnUntraced(function* (
        path: string,
        base: string,
        branch: string,
        taskId: string,
        signal?: AbortSignal
      ) {
        const update = yield* remote.updateOntoBase(path, base, branch, Effect.void, signal).pipe(
          Effect.catchTags({
            PushError: (error) => Effect.as(logBaseUnreached(taskId, base, error.detail), null),
            GitFailed: (error) => Effect.as(logBaseUnreached(taskId, base, error.message), null),
          })
        );
        if (update?.status !== 'conflicted') return;
        yield* Effect.logInfo(
          '[Workspaces] The latest base conflicts with the branch; the push resolves it'
        ).pipe(Effect.annotateLogs({ taskId, base, files: update.files.join(', ') }));
      });

      const make = (root: WorktreeRoot['Service']): Workspace => ({
        mode: 'worktrees',
        prepare: Effect.fn('WorktreeWorkspace.prepare')(function* (
          repo: Repo,
          task: Task,
          signal?: AbortSignal
        ) {
          const { worktreePath, branch } = task;
          const [base = null, ...others] = resolveRoundBases(task);
          if (worktreePath && branch && (yield* Effect.sync(() => existsSync(worktreePath)))) {
            if (task.phaseReports.length === 0 && isLaterRound(task)) {
              yield* checkout.discard(worktreePath, signal);
              yield* mergeLatestBase(worktreePath, base ?? repo.defaultBranch, branch, task.id, signal);
            } else if (task.phaseReports.length === 0 && !task.pullRequest) {
              yield* checkout.refresh(repo, worktreePath, base, signal);
              yield* checkout.mergeBranches(worktreePath, branch, others, signal);
            }
            return { path: worktreePath, branch };
          }
          if (!branch) return yield* new TaskCheckoutMissing({ message: NO_BRANCH_YET });
          const worktreesDir = yield* root.assert;
          const created = yield* checkout.create(repo, worktreesDir, task.id, branch, base, signal);
          yield* checkout.mergeBranches(created.path, created.branch, others, signal);
          return created;
        }),
        commit: (_repo, task, message) =>
          Effect.flatMap(requireCheckout(task), ({ path }) => commit(path, message)),
        push: (_repo, task, signal) =>
          Effect.flatMap(requireCheckout(task), ({ path, branch }) =>
            remote.pushBranch(path, branch, signal).pipe(Effect.andThen(checkout.head(path)))
          ),
        remove: (repo, task) => (task.worktreePath ? checkout.remove(repo, task.worktreePath) : Effect.void),
        writeEdit: (_repo, _task, _path, write) => Effect.asVoid(write),
        syncBase: (_repo, task, base, onBehind, signal) =>
          Effect.flatMap(requireCheckout(task), ({ path, branch }) =>
            remote.updateOntoBase(path, base, branch, onBehind, signal)
          ),
      });

      return WorktreeWorkspaces.of({ make, commit });
    })
  );
}
