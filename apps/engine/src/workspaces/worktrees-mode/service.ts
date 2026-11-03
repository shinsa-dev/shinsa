import { existsSync } from 'node:fs';
import { isLaterRound, type Repo, resolveRoundBases, type Task } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { MergeUnresolved } from '../../git/checkout/schema.ts';
import { Checkout } from '../../git/checkout/service.ts';
import { Remote } from '../../git/remote/service.ts';
import type { GitFailed } from '../../git/schema.ts';
import { Git } from '../../git/service.ts';
import { requireCheckout } from '../checkout.ts';
import { type CheckoutCommit, NO_BRANCH_YET, TaskCheckoutMissing, type Workspace } from '../schema.ts';

export class WorktreeWorkspaces extends Context.Service<
  WorktreeWorkspaces,
  {
    make(worktreesDir: string): Workspace;
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

      const make = (worktreesDir: string): Workspace => ({
        mode: 'worktrees',
        prepare: Effect.fn('WorktreeWorkspace.prepare')(function* (
          repo: Repo,
          task: Task,
          signal?: AbortSignal
        ) {
          const { worktreePath, branch } = task;
          const [base = null, ...others] = resolveRoundBases(task);
          if (worktreePath && branch && (yield* Effect.sync(() => existsSync(worktreePath)))) {
            if (task.phaseReports.length === 0 && isLaterRound(task))
              yield* checkout.discard(worktreePath, signal);
            else if (task.phaseReports.length === 0 && !task.pullRequest) {
              yield* checkout.refresh(repo, worktreePath, base, signal);
              yield* checkout.mergeBranches(worktreePath, branch, others, signal);
            }
            return { path: worktreePath, branch };
          }
          if (!branch) return yield* new TaskCheckoutMissing({ message: NO_BRANCH_YET });
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
