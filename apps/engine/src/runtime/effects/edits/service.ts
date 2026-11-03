import type { Repo, Task } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { EffectAttempt } from '../../engine/schema.ts';
import type { EffectFailure } from '../../failures/schema.ts';
import { EDITS_COMMIT_MESSAGE } from '../schema.ts';
import { EffectWorld } from '../world/service.ts';

export class EditCommits extends Context.Service<
  EditCommits,
  { commit(task: Task, repo: Repo, attempt: EffectAttempt): Effect.Effect<void, EffectFailure> }
>()('shinsa/engine/runtime/effects/edits/EditCommits') {
  static readonly layer = Layer.effect(
    EditCommits,
    Effect.gen(function* () {
      const world = yield* EffectWorld;

      const commit = Effect.fn('EditCommits.commit')(function* (
        task: Task,
        repo: Repo,
        attempt: EffectAttempt
      ) {
        if ((task.editedPaths ?? []).length === 0) return;
        const committed = yield* world.bridge(() =>
          world.workspaces.resolve(task).commit(repo, task, EDITS_COMMIT_MESSAGE)
        );
        yield* world.dispatch(
          { type: 'task.commit_edits', taskId: task.id, treeHash: committed.treeHash },
          { id: `${attempt.key}:task.commit_edits:${committed.treeHash ?? 'none'}` }
        );
      }, Effect.uninterruptible);

      return EditCommits.of({ commit });
    })
  );
}
