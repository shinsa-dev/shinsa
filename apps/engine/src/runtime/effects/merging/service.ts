import {
  listStackedPullRequests,
  type PullRequestCloseFailure,
  type Repo,
  type RoundPullRequest,
  type Task,
} from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { checkBundleMerge } from '../../../git/index.ts';
import {
  closePullRequest,
  mergePullRequest,
  readPullRequest,
  readStackedPullRequest,
} from '../../../github/index.ts';
import type { EffectAttempt } from '../../engine/schema.ts';
import { createEffectFailed } from '../../failures/classify.ts';
import type { EffectFailure } from '../../failures/schema.ts';
import { isAwaitingMerge, isHeadMoved, needsMerge } from '../pull-requests/news.ts';
import { PullRequestSync } from '../pull-requests/service.ts';
import { CANCELLED_COMMENT, type EffectOf, NO_PULL_REQUEST, NOT_MERGED_YET } from '../schema.ts';
import { EffectWorld } from '../world/service.ts';

export class Merging extends Context.Service<
  Merging,
  {
    merge(effect: EffectOf<'pull_request.merge'>): Effect.Effect<void, EffectFailure>;
    close(effect: EffectOf<'pull_request.close'>, attempt: EffectAttempt): Effect.Effect<void, EffectFailure>;
  }
>()('shinsa/engine/runtime/effects/merging/Merging') {
  static readonly layer = Layer.effect(
    Merging,
    Effect.gen(function* () {
      const world = yield* EffectWorld;
      const pullRequests = yield* PullRequestSync;

      const read = (repo: Repo, task: Task) => world.bridge((signal) => readPullRequest(repo, task, signal));

      const readStacked = (repo: Repo, number: number) =>
        world.bridge((signal) => readStackedPullRequest(repo, number, signal));

      const mergeNumber = Effect.fn('Merging.mergeNumber')(function* (
        repo: Repo,
        number: number,
        headSha: string | null
      ) {
        const method = (yield* world.state).settings.mergeMethod;
        yield* world.bridge((signal) => mergePullRequest(repo, number, method, headSha, signal));
      });

      const recoverMovedHead = Effect.fn('Merging.recoverMovedHead')(function* (
        repo: Repo,
        task: Task,
        headSha: string | null,
        failure: EffectFailure
      ) {
        const current = yield* read(repo, task);
        if (!current || !isHeadMoved(headSha, current.pullRequest)) return yield* failure;
        yield* pullRequests.recordFreshRead(repo, task.id, current);
        return false;
      });

      const mergeHead = Effect.fn('Merging.mergeHead')(function* (
        repo: Repo,
        task: Task,
        number: number,
        headSha: string | null
      ) {
        return yield* mergeNumber(repo, number, headSha).pipe(
          Effect.as(true),
          Effect.catch((failure) => recoverMovedHead(repo, task, headSha, failure))
        );
      });

      const mergeStack = Effect.fn('Merging.mergeStack')(function* (repo: Repo, stacked: RoundPullRequest[]) {
        for (const pull of stacked) {
          const current = yield* readStacked(repo, pull.number);
          if (needsMerge(current?.pullRequest)) yield* mergeNumber(repo, pull.number, null);
        }
      });

      const assertStackMerged = Effect.fn('Merging.assertStackMerged')(function* (
        repo: Repo,
        stacked: RoundPullRequest[]
      ) {
        for (const pull of stacked) {
          const current = yield* readStacked(repo, pull.number);
          if (current && isAwaitingMerge(current.pullRequest)) {
            return yield* createEffectFailed(
              `GitHub still shows pull request #${pull.number} below this one as open after merging it. Retry to check it again and merge it.`
            );
          }
        }
      });

      const mergeTask = Effect.fn('Merging.mergeTask')(function* (taskId: string, headSha: string | null) {
        const { task, repo } = yield* world.findTask(taskId);
        const pullRequest = task.pullRequest;
        if (!pullRequest) return yield* createEffectFailed(NO_PULL_REQUEST);
        const current = yield* read(repo, task);
        if (current && needsMerge(current.pullRequest) && isHeadMoved(headSha, current.pullRequest)) {
          yield* pullRequests.recordFreshRead(repo, taskId, current);
          return false;
        }
        if (
          needsMerge(current?.pullRequest) &&
          !(yield* mergeHead(repo, task, pullRequest.number, headSha))
        ) {
          return false;
        }
        const stacked = listStackedPullRequests(task);
        yield* mergeStack(repo, stacked);
        const after = yield* read(repo, task);
        if (after) yield* pullRequests.recordFreshRead(repo, taskId, after);
        if (after && isAwaitingMerge(after.pullRequest)) return yield* createEffectFailed(NOT_MERGED_YET);
        yield* assertStackMerged(repo, stacked);
        return true;
      });

      const isRootMoved = Effect.fn('Merging.isRootMoved')(function* (
        taskId: string,
        headSha: string | null
      ) {
        const { task, repo } = yield* world.findTask(taskId);
        const current = yield* read(repo, task);
        if (!current || !needsMerge(current.pullRequest) || !isHeadMoved(headSha, current.pullRequest)) {
          return false;
        }
        yield* pullRequests.recordFreshRead(repo, taskId, current);
        return true;
      });

      const assertBundleMerges = Effect.fn('Merging.assertBundleMerges')(function* (taskId: string) {
        const { task, repo } = yield* world.findTask(taskId);
        const branches = yield* pullRequests.listBundleBranches(repo, task);
        const conflict = yield* world.bridge((signal) => checkBundleMerge(repo, branches, signal));
        if (!conflict) return;
        const title = (yield* world.state).tasks[conflict.taskId]?.title ?? 'A task';
        return yield* createEffectFailed(
          `“${title}” conflicts with ${repo.defaultBranch} once the bundle merges, so nothing was merged. Retry to bring the bundle up to date first.`
        );
      });

      const merge = Effect.fn('Merging.merge')(function* (effect: EffectOf<'pull_request.merge'>) {
        const bundle = effect.bundle ?? [];
        if (bundle.length === 0) {
          yield* mergeTask(effect.taskId, effect.headSha);
          return;
        }
        if (yield* isRootMoved(effect.taskId, effect.headSha)) return;
        yield* assertBundleMerges(effect.taskId);
        for (const member of bundle) {
          if (!(yield* mergeTask(member.taskId, null))) return;
        }
        yield* mergeTask(effect.taskId, null);
      });

      const close = Effect.fn('Merging.close')(function* (
        effect: EffectOf<'pull_request.close'>,
        attempt: EffectAttempt
      ) {
        const { repo } = yield* world.findTask(effect.taskId);
        const closed: number[] = [];
        const failed: PullRequestCloseFailure[] = [];
        for (const number of effect.numbers) {
          yield* world
            .bridge((signal) => closePullRequest(repo, number, CANCELLED_COMMENT, signal))
            .pipe(
              Effect.andThen(Effect.sync(() => closed.push(number))),
              Effect.catch((failure) =>
                Effect.logWarning('[Effects] Could not close a pull request').pipe(
                  Effect.annotateLogs({ taskId: effect.taskId, number, error: failure.message }),
                  Effect.andThen(Effect.sync(() => failed.push({ number, detail: failure.message })))
                )
              )
            );
        }
        yield* world.dispatch(
          { type: 'pull_request.record_closed', taskId: effect.taskId, closed, failed },
          { id: `${attempt.key}:pull_request.record_closed` }
        );
      });

      return Merging.of({ merge, close });
    })
  );
}
