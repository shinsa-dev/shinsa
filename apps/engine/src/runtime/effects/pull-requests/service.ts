import {
  isBundleFollower,
  listBundleFollowers,
  type PullRequest,
  type Repo,
  type RepoCi,
  resolveRoundBase,
  type Task,
} from '@shinsa/core';
import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  FiberSet,
  Layer,
  RcMap,
  Ref,
  Schedule,
  Semaphore,
  SynchronizedRef,
} from 'effect';
import { type BundleBranch, checkBundleMerge, syncRemoteBranch } from '../../../git/index.ts';
import { type PullRequestRead, readPullRequest, retargetPullRequest } from '../../../github/index.ts';
import { describeError } from '../../../log/redact.ts';
import { syncRepoRemote } from '../../../repos/index.ts';
import type { EffectFailure } from '../../failures/schema.ts';
import { RATE_LIMITED } from '../schema.ts';
import { EffectWorld } from '../world/service.ts';
import { hasPullRequestNews } from './news.ts';

export class PullRequestSync extends Context.Service<
  PullRequestSync,
  {
    sync(taskId: string, force?: boolean): Effect.Effect<PullRequest | null, EffectFailure>;
    readonly syncAll: Effect.Effect<void, EffectFailure>;
    syncSoon(taskId: string): Effect.Effect<void>;
    recordFreshRead(repo: Repo, taskId: string, read: PullRequestRead): Effect.Effect<void, EffectFailure>;
    listBundleBranches(repo: Repo, root: Task): Effect.Effect<BundleBranch[]>;
    readonly startWatching: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
  }
>()('shinsa/engine/runtime/effects/pull-requests/PullRequestSync') {
  static readonly layer = Layer.effect(
    PullRequestSync,
    Effect.gen(function* () {
      const world = yield* EffectWorld;
      const locks = yield* RcMap.make({ lookup: (_taskId: string) => Semaphore.make(1) });
      const syncing = yield* SynchronizedRef.make<Fiber.Fiber<void, EffectFailure> | null>(null);
      const watching = yield* FiberHandle.make();
      const background = yield* FiberSet.make();
      const stopped = yield* Ref.make(false);

      const listBundleBranches = Effect.fn('PullRequestSync.listBundleBranches')(function* (
        repo: Repo,
        root: Task
      ) {
        const state = yield* world.state;
        const above = listBundleFollowers(state, root);
        if (isBundleFollower(state, root) || above.length === 0 || !root.branch) return [];
        if (!above.every((member) => member.bundleReady && member.branch)) return [];
        const branches: BundleBranch[] = [
          { taskId: root.id, branch: root.branch, base: repo.defaultBranch },
          ...above.map((member) => ({
            taskId: member.id,
            branch: member.branch ?? '',
            base: resolveRoundBase(member) ?? repo.defaultBranch,
          })),
        ];
        return branches;
      });

      const resolveCi = Effect.fn('PullRequestSync.resolveCi')(function* (
        repo: Repo,
        pullRequest: PullRequest
      ) {
        if (pullRequest.state !== 'open' || pullRequest.checks !== 'none') return 'unknown' as RepoCi;
        return yield* world.bridge((signal) =>
          world.ci.resolve(repo, pullRequest.base ?? repo.defaultBranch, signal)
        );
      });

      const recordRead = Effect.fn('PullRequestSync.recordRead')(function* (
        taskId: string,
        read: PullRequestRead,
        ci: RepoCi
      ) {
        yield* world.dispatch({
          type: 'pull_request.record',
          taskId,
          pullRequest: read.pullRequest,
          remarks: read.remarks,
          viewer: read.viewer,
          ci,
        });
      });

      const recordFreshRead = Effect.fn('PullRequestSync.recordFreshRead')(function* (
        repo: Repo,
        taskId: string,
        read: PullRequestRead
      ) {
        yield* recordRead(taskId, read, yield* resolveCi(repo, read.pullRequest));
      });

      const recordReadFailure = Effect.fn('PullRequestSync.recordReadFailure')(function* (
        taskId: string,
        detail: string
      ) {
        if (RATE_LIMITED.test(detail)) {
          yield* Effect.logWarning(
            '[Watch] GitHub is rate limiting reads; this one does not count as a failure'
          ).pipe(Effect.annotateLogs({ taskId, error: detail }));
          return;
        }
        yield* Effect.logWarning('[Watch] Could not read a pull request').pipe(
          Effect.annotateLogs({ taskId, error: detail })
        );
        yield* world.dispatch({ type: 'pull_request.read_failed', taskId, detail });
      });

      const checkBundle = Effect.fn('PullRequestSync.checkBundle')(function* (
        repo: Repo,
        task: Task,
        pullRequest: PullRequest
      ) {
        const branches = yield* listBundleBranches(repo, task);
        if (pullRequest.state !== 'open' || branches.length === 0) return;
        const conflict = yield* world
          .bridge((signal) => checkBundleMerge(repo, branches, signal))
          .pipe(
            Effect.catch((failure) =>
              Effect.logWarning(
                '[Watch] Could not check that the bundle merges into the default branch'
              ).pipe(Effect.annotateLogs({ taskId: task.id, error: failure.message }), Effect.as(undefined))
            )
          );
        if (conflict === undefined) return;
        yield* world.dispatch({ type: 'bundle.record_check', taskId: task.id, conflict });
      });

      const syncConflictBase = Effect.fn('PullRequestSync.syncConflictBase')(function* (
        repo: Repo,
        taskId: string,
        pullRequest: PullRequest
      ) {
        const base = pullRequest.base;
        if (pullRequest.mergeable !== false || !base) return;
        const error = yield* world
          .bridge((signal) => syncRemoteBranch(repo, base, signal))
          .pipe(
            Effect.map((result) => (result.ok ? null : result.stderr)),
            Effect.catch((failure) => Effect.succeed(failure.message))
          );
        if (error === null) return;
        yield* Effect.logWarning(
          '[Watch] Could not fetch the base of a conflicting pull request; the agent fetches it'
        ).pipe(Effect.annotateLogs({ taskId, base, error }));
      });

      const syncTask = Effect.fn('PullRequestSync.syncTask')(function* (taskId: string, force: boolean) {
        const state = yield* world.state;
        const task = state.tasks[taskId];
        const known = task?.repoId ? state.repos[task.repoId] : undefined;
        if (!task || !known) return null;
        const repo = yield* world.bridge(() => syncRepoRemote(world.engine, known));
        const read = yield* Effect.gen(function* () {
          const wanted = resolveRoundBase(task) ?? repo.defaultBranch;
          const current = task.pullRequest;
          if (current?.state === 'open' && current.base && current.base !== wanted) {
            yield* world.bridge((signal) => retargetPullRequest(repo, current.number, wanted, signal));
          }
          return yield* world.bridge((signal) => readPullRequest(repo, task, signal));
        }).pipe(
          Effect.catch((failure) => recordReadFailure(taskId, failure.message).pipe(Effect.as(undefined)))
        );
        if (!read) return null;
        yield* checkBundle(repo, task, read.pullRequest);
        const ci = yield* resolveCi(repo, read.pullRequest);
        if (force || hasPullRequestNews(task, read, ci, yield* Clock.currentTimeMillis)) {
          yield* syncConflictBase(repo, taskId, read.pullRequest);
          yield* recordRead(taskId, read, ci);
        }
        return read.pullRequest;
      });

      const sync = Effect.fn('PullRequestSync.sync')(function* (taskId: string, force = false) {
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const lock = yield* RcMap.get(locks, taskId);
            return yield* Semaphore.withPermit(lock, syncTask(taskId, force));
          })
        );
      });

      const syncWatched = Effect.gen(function* () {
        const state = yield* world.state;
        const watched = Object.values(state.tasks).filter(
          (task) =>
            (task.stage === 'shipping' || task.stage === 'awaiting_merge') && !task.pullRequestWatch?.stopped
        );
        for (const task of watched) yield* sync(task.id);
        const failure = yield* world.bridge((signal) => world.feedback.syncIssues(signal));
        if (failure) {
          yield* Effect.logWarning('[Feedback] Could not read the state of opened issues').pipe(
            Effect.annotateLogs({ error: failure })
          );
        }
      });

      const syncAll = Effect.gen(function* () {
        if (yield* Ref.get(stopped)) return;
        const fiber = yield* SynchronizedRef.modifyEffect(syncing, (current) => {
          if (current) return Effect.succeed([current, current] as const);
          return syncWatched.pipe(
            Effect.ensuring(SynchronizedRef.set(syncing, null)),
            FiberSet.run(background),
            Effect.map((started) => [started, started] as const)
          );
        });
        const exit = yield* Fiber.await(fiber);
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
          return yield* Effect.failCause(exit.cause);
      });

      const logSyncFailure = (fields: Record<string, string>) => (cause: Cause.Cause<EffectFailure>) =>
        Effect.logWarning('[Watch] Pull request sync failed').pipe(
          Effect.annotateLogs({ ...fields, error: describeError(Cause.squash(cause)) })
        );

      const syncSoon = Effect.fn('PullRequestSync.syncSoon')(function* (taskId: string) {
        if (yield* Ref.get(stopped)) return;
        yield* Effect.sleep(world.config.settleDelayMs).pipe(
          Effect.andThen(sync(taskId, true)),
          Effect.catchCause(logSyncFailure({ taskId })),
          FiberSet.run(background)
        );
      });

      const watchSchedule = Schedule.spaced(world.watchInterval);

      const watch = syncAll.pipe(
        Effect.catchCause(logSyncFailure({})),
        Effect.delay(world.watchInterval),
        Effect.repeat(watchSchedule)
      );

      return PullRequestSync.of({
        sync,
        syncAll,
        syncSoon,
        recordFreshRead,
        listBundleBranches,
        startWatching: FiberHandle.run(watching, watch, { onlyIfMissing: true }).pipe(Effect.asVoid),
        stop: Ref.set(stopped, true).pipe(
          Effect.andThen(FiberHandle.clear(watching)),
          Effect.andThen(FiberSet.clear(background))
        ),
      });
    })
  );
}
