import { resolve } from 'node:path';
import { isTaskSettled, type Repo } from '@shinsa/core';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { SharedCaches } from '../../../checks/caches/service.ts';
import { resolveScratchPath } from '../../../config/index.ts';
import { Checkout } from '../../../git/checkout/service.ts';
import { LeftoverProcesses } from '../../../git/leftovers/service.ts';
import { describeError } from '../../../log/redact.ts';
import type { EffectAttempt } from '../../engine/schema.ts';
import { resolveEffectFailure } from '../../failures/classify.ts';
import type { EffectFailure } from '../../failures/schema.ts';
import { EffectWorld } from '../world/service.ts';

export class Cleanup extends Context.Service<
  Cleanup,
  {
    removeWorktree(taskId: string, attempt: EffectAttempt): Effect.Effect<void, EffectFailure>;
    removeScratch(taskId: string): Effect.Effect<void, EffectFailure>;
  }
>()('shinsa/engine/runtime/effects/cleanup/Cleanup') {
  static readonly layer = Layer.effect(
    Cleanup,
    Effect.gen(function* () {
      const world = yield* EffectWorld;
      const checkout = yield* Checkout;
      const leftovers = yield* LeftoverProcesses;
      const caches = yield* SharedCaches;
      const fs = yield* FileSystem.FileSystem;

      const removeIsolated = Effect.fn('Cleanup.removeIsolated')(function* (repo: Repo, taskId: string) {
        yield* checkout
          .removeIsolated(repo, yield* world.workspaces.root.path, taskId)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning('[Effects] Could not remove the checkouts of delegations').pipe(
                Effect.annotateLogs({ taskId, error: error.message })
              )
            )
          );
      });

      const closeTerminals = Effect.fn('Cleanup.closeTerminals')(function* (taskId: string) {
        if (world.services) yield* world.services.closeTaskTerminals(taskId);
      });

      const removeWorktree = Effect.fn('Cleanup.removeWorktree')(function* (
        taskId: string,
        attempt: EffectAttempt
      ) {
        const state = yield* world.state;
        const task = state.tasks[taskId];
        const repo = task?.repoId ? state.repos[task.repoId] : undefined;
        if (repo) yield* removeIsolated(repo, taskId);
        const worktreePath = task?.worktreePath;
        if (!task || !worktreePath || !repo) return;
        yield* closeTerminals(taskId);
        const services = world.services;
        yield* Effect.gen(function* () {
          if (resolve(worktreePath) !== resolve(repo.path)) {
            const spare = services ? yield* services.listTerminalPids : [];
            yield* leftovers.stop(worktreePath, { spare });
          }
          yield* Effect.mapError(world.workspaces.remove(repo, task), resolveEffectFailure);
        }).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Effects] Could not remove a worktree').pipe(
              Effect.annotateLogs({ taskId, error: failure.message })
            )
          )
        );
        const now = yield* Clock.currentTimeMillis;
        const repoIds = Object.keys((yield* world.state).repos);
        yield* caches
          .prune(world.config.dataDir, repoIds, now)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning('[Effects] Could not prune the shared build caches').pipe(
                Effect.annotateLogs({ error: describeError(error) })
              )
            )
          );
        yield* world.dispatch({ type: 'worktree.gone', taskId }, { id: `${attempt.key}:worktree.gone` });
      });

      const isReopened = Effect.fn('Cleanup.isReopened')(function* (taskId: string) {
        const task = (yield* world.state).tasks[taskId];
        return task !== undefined && !isTaskSettled(task);
      });

      const removeScratch = Effect.fn('Cleanup.removeScratch')(function* (taskId: string) {
        if (yield* isReopened(taskId)) return;
        yield* world.runs.quiesce(taskId);
        if (yield* isReopened(taskId)) return;
        yield* closeTerminals(taskId);
        yield* fs
          .remove(resolveScratchPath(world.config.dataDir, taskId), { recursive: true, force: true })
          .pipe(Effect.mapError(resolveEffectFailure));
      });

      return Cleanup.of({ removeWorktree, removeScratch });
    })
  );
}
