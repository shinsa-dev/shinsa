import {
  type PullRequest,
  type Repo,
  resolveRoundBase,
  resolveRoundBases,
  type ShippingStep,
  type Task,
} from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { listCheckFailures } from '../../../checks/failures.ts';
import { hasPrePushHook, PushError, resolveOutputTail } from '../../../git/index.ts';
import { createPullRequest, writePullRequestBlock } from '../../../github/index.ts';
import type { EffectAttempt } from '../../engine/schema.ts';
import { createEffectFailed, resolveShippingFailure } from '../../failures/classify.ts';
import type { EffectFailure, ShippingFailed, ShippingStepKind } from '../../failures/schema.ts';
import { EditCommits } from '../edits/service.ts';
import { PullRequestSync } from '../pull-requests/service.ts';
import { HookRejected, NOT_CREATED } from '../schema.ts';
import { EffectWorld } from '../world/service.ts';

export class Shipping extends Context.Service<
  Shipping,
  {
    open(taskId: string, attempt: EffectAttempt): Effect.Effect<void, EffectFailure>;
    push(taskId: string, attempt: EffectAttempt): Effect.Effect<void, EffectFailure>;
  }
>()('shinsa/engine/runtime/effects/shipping/Shipping') {
  static readonly layer = Layer.effect(
    Shipping,
    Effect.gen(function* () {
      const world = yield* EffectWorld;
      const edits = yield* EditCommits;
      const pullRequests = yield* PullRequestSync;
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const asShipping =
        (step: ShippingStepKind) =>
        (error: unknown): ShippingFailed =>
          resolveShippingFailure(step, error, world.config.pushRetryMs);

      const resolveStepKey = (step: ShippingStep) =>
        step.kind === 'updating' ? `updating:${step.base}` : step.kind;

      const recordStep = Effect.fn('Shipping.recordStep')(function* (
        taskId: string,
        step: ShippingStep,
        attempt: EffectAttempt
      ) {
        yield* world.dispatch(
          { type: 'pull_request.record_step', taskId, step },
          { id: `${attempt.key}:${attempt.attempt}:pull_request.record_step:${resolveStepKey(step)}` }
        );
      });

      const updateOnto = Effect.fn('Shipping.updateOnto')(function* (
        task: Task,
        repo: Repo,
        base: string,
        attempt: EffectAttempt
      ) {
        const update = yield* world.bridgeWith(
          (signal) =>
            world.workspaces.resolve(task).syncBase(repo, task, base, {
              signal,
              onBehind: () => runPromise(recordStep(task.id, { kind: 'updating', base }, attempt)),
            }),
          asShipping('updating')
        );
        if (update.status !== 'conflicted') return true;
        yield* world.dispatch(
          { type: 'pull_request.record_update_conflict', taskId: task.id, base, files: update.files },
          { id: `${attempt.key}:${attempt.attempt}:pull_request.record_update_conflict` }
        );
        return false;
      });

      const updateOntoBases = Effect.fn('Shipping.updateOntoBases')(function* (
        task: Task,
        repo: Repo,
        attempt: EffectAttempt
      ) {
        const bases = resolveRoundBases(task);
        for (const base of bases.length > 0 ? bases : [repo.defaultBranch]) {
          if (!(yield* updateOnto(task, repo, base, attempt))) return false;
        }
        return true;
      });

      const recordHookFailure = Effect.fn('Shipping.recordHookFailure')(function* (
        task: Task,
        rejected: HookRejected,
        attempt: EffectAttempt
      ) {
        const output = resolveOutputTail(rejected.output);
        const failures = listCheckFailures(output, task.worktreePath ?? '');
        yield* world.dispatch(
          {
            type: 'pull_request.record_hook_failure',
            taskId: task.id,
            output,
            failures: failures ? failures.map((failure) => failure.label) : null,
          },
          { id: `${attempt.key}:${attempt.attempt}:pull_request.record_hook_failure` }
        );
        return null;
      });

      const pushBranch = Effect.fn('Shipping.pushBranch')(function* (
        task: Task,
        repo: Repo,
        attempt: EffectAttempt
      ) {
        const hook = yield* world.bridge((signal) => hasPrePushHook(task.worktreePath ?? repo.path, signal));
        yield* recordStep(task.id, { kind: 'pushing', hook }, attempt);
        return yield* world
          .bridgeWith(
            (signal) => world.workspaces.resolve(task).push(repo, task, signal),
            (error) =>
              error instanceof PushError && error.kind === 'hook'
                ? new HookRejected({ output: error.output })
                : asShipping('pushing')(error)
          )
          .pipe(Effect.catchTag('HookRejected', (rejected) => recordHookFailure(task, rejected, attempt)));
      });

      const pushHead = Effect.fn('Shipping.pushHead')(function* (
        task: Task,
        repo: Repo,
        attempt: EffectAttempt
      ) {
        yield* world.bridge(() => world.runs.quiesce(task.id));
        yield* edits.commit(task, repo, attempt);
        if (!(yield* updateOntoBases(task, repo, attempt))) return false;
        const sha = yield* pushBranch(task, repo, attempt).pipe(Effect.mapError(asShipping('pushing')));
        if (sha === null) return false;
        yield* world.dispatch(
          { type: 'pull_request.record_push', taskId: task.id, sha },
          { id: `${attempt.key}:pull_request.record_push:${sha}` }
        );
        return true;
      });

      const describePullRequest = Effect.fn('Shipping.describePullRequest')(function* (
        taskId: string,
        attempt: EffectAttempt,
        pullRequest?: PullRequest
      ) {
        const { task: current, repo } = yield* world.findTask(taskId);
        const task = pullRequest ? { ...current, pullRequest } : current;
        const evidence = Object.values((yield* world.state).evidence).filter(
          (piece) => piece.taskId === taskId
        );
        const { body, uploads } = yield* world.bridge((signal) =>
          world.descriptions.describe(repo, task, evidence, signal)
        );
        if (uploads.length === 0) return body;
        const ids = uploads.map((upload) => upload.evidenceId).join(',');
        yield* world.dispatch(
          { type: 'evidence.record_uploads', taskId, uploads },
          { id: `${attempt.key}:${attempt.attempt}:evidence.record_uploads:${ids}` }
        );
        return body;
      });

      const refreshDescription = Effect.fn('Shipping.refreshDescription')(function* (
        taskId: string,
        attempt: EffectAttempt,
        opened?: PullRequest
      ) {
        const number = (opened ?? (yield* world.state).tasks[taskId]?.pullRequest)?.number;
        if (number === undefined) return;
        yield* Effect.gen(function* () {
          const body = yield* describePullRequest(taskId, attempt, opened);
          const { repo } = yield* world.findTask(taskId);
          yield* world.bridge((signal) => writePullRequestBlock(repo, number, body, signal));
        }).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[GitHub] Could not refresh the pull request description').pipe(
              Effect.annotateLogs({ taskId, number, error: failure.message })
            )
          )
        );
      });

      const createOpened = Effect.fn('Shipping.createOpened')(function* (
        taskId: string,
        task: Task,
        repo: Repo,
        attempt: EffectAttempt
      ) {
        const body = yield* describePullRequest(taskId, attempt);
        const created = yield* world.bridge((signal) =>
          createPullRequest(repo, task, resolveRoundBase(task), body, signal)
        );
        if (!created) return yield* createEffectFailed(NOT_CREATED);
        return created;
      });

      const open = Effect.fn('Shipping.open')(function* (taskId: string, attempt: EffectAttempt) {
        const { task, repo } = yield* world.findCheckout(taskId).pipe(Effect.mapError(asShipping('pushing')));
        if (!(yield* pushHead(task, repo, attempt))) return;
        yield* recordStep(taskId, { kind: 'opening' }, attempt);
        const read = yield* createOpened(taskId, task, repo, attempt).pipe(
          Effect.mapError(asShipping('opening'))
        );
        yield* refreshDescription(taskId, attempt, read.pullRequest);
        yield* pullRequests.recordFreshRead(repo, taskId, read);
        yield* pullRequests.syncSoon(taskId);
      });

      const push = Effect.fn('Shipping.push')(function* (taskId: string, attempt: EffectAttempt) {
        const { task, repo } = yield* world.findCheckout(taskId).pipe(Effect.mapError(asShipping('pushing')));
        if (!task.pullRequest) return yield* open(taskId, attempt);
        if (!(yield* pushHead(task, repo, attempt))) return;
        yield* refreshDescription(taskId, attempt);
        yield* pullRequests.syncSoon(taskId);
      });

      return Shipping.of({ open, push });
    })
  );
}
