import { rmSync } from 'node:fs';
import { isTaskSettled, type Repo } from '@shinsa/core';
import { Clock, Context, Effect, Layer } from 'effect';
import { pruneSharedCaches } from '../../../checks/caches.ts';
import { resolveScratchPath } from '../../../config/index.ts';
import { removeIsolatedWorktrees } from '../../../git/index.ts';
import { stopProcessesIn } from '../../../git/processes.ts';
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

      const removeIsolated = Effect.fn('Cleanup.removeIsolated')(function* (repo: Repo, taskId: string) {
        yield* world
          .bridge(() => removeIsolatedWorktrees(repo, world.workspaces.root.path, taskId))
          .pipe(
            Effect.catch((failure) =>
              Effect.logWarning('[Effects] Could not remove the checkouts of delegations').pipe(
                Effect.annotateLogs({ taskId, error: failure.message })
              )
            )
          );
      });

      const closeTerminals = Effect.fn('Cleanup.closeTerminals')(function* (taskId: string) {
        const services = world.services;
        if (!services) return;
        yield* Effect.try({ try: () => services.closeTaskTerminals(taskId), catch: resolveEffectFailure });
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
          const workspace = yield* Effect.try({
            try: () => world.workspaces.resolve(task),
            catch: resolveEffectFailure,
          });
          if (workspace.mode === 'worktrees') {
            const spare = services?.listTerminalPids() ?? [];
            yield* world.bridge(() => stopProcessesIn(worktreePath, { spare }));
          }
          yield* world.bridge(() => workspace.remove(repo, task));
        }).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Effects] Could not remove a worktree').pipe(
              Effect.annotateLogs({ taskId, error: failure.message })
            )
          )
        );
        const now = yield* Clock.currentTimeMillis;
        const repoIds = Object.keys((yield* world.state).repos);
        yield* Effect.try({
          try: () => pruneSharedCaches(world.config.dataDir, repoIds, now),
          catch: resolveEffectFailure,
        }).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Effects] Could not prune the shared build caches').pipe(
              Effect.annotateLogs({ error: failure.message })
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
        yield* world.bridge(() => world.runs.quiesce(taskId));
        if (yield* isReopened(taskId)) return;
        yield* closeTerminals(taskId);
        yield* Effect.try({
          try: () =>
            rmSync(resolveScratchPath(world.config.dataDir, taskId), { recursive: true, force: true }),
          catch: resolveEffectFailure,
        });
      });

      return Cleanup.of({ removeWorktree, removeScratch });
    })
  );
}
