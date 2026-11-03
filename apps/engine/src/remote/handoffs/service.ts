import type { TaskGuest } from '@shinsa/core';
import { Effect } from 'effect';
import type { EffectContext } from '../../runtime/engine.ts';
import { EffectFailed } from '../../runtime/failures/schema.ts';
import { CLAIM_FAILED, type HandoffsDefinition, type HandoffsHandle } from './schema.ts';

export const makeHandoffs = (definition: HandoffsDefinition) =>
  Effect.sync(() => {
    const failLink = (message: string, retryable: boolean) =>
      Effect.fail(new EffectFailed({ message, detail: message, retryable, delayMs: null }));

    const link = Effect.fn('Handoffs.link')(function* (taskId: string, context: EffectContext) {
      const handoff = (yield* definition.state).tasks[taskId]?.handoff;
      if (!handoff || handoff.guest) return;
      const url = yield* definition.createHandoff(taskId).pipe(
        Effect.catchTags({
          DomainError: (error) => failLink(error.message, false),
          HandoffCallFailed: (error) => failLink(error.message, true),
        })
      );
      yield* definition
        .dispatch({ type: 'handoff.record', taskId, url }, `${context.key}:handoff.record`)
        .pipe(
          Effect.catchTags({
            DomainError: (error) => failLink(error.message, true),
            HandoffCommandFailed: (error) => failLink(error.message, true),
          })
        );
    });

    const claim = Effect.fn('Handoffs.claim')(function* (taskId: string, user: TaskGuest) {
      const guest = { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl };
      return yield* definition.dispatch({ type: 'handoff.claim', taskId, guest }).pipe(
        Effect.as(null),
        Effect.catchTags({
          DomainError: (error) => Effect.succeed(error.message),
          HandoffCommandFailed: (error) =>
            Effect.logWarning('[Handoff] Could not record a claim').pipe(
              Effect.annotateLogs({ taskId, error: error.message }),
              Effect.as(CLAIM_FAILED)
            ),
        })
      );
    });

    const leave = Effect.fn('Handoffs.leave')(function* (userIds: readonly string[]) {
      const left = new Set(userIds);
      for (const task of Object.values((yield* definition.state).tasks)) {
        const guest = task.handoff?.guest;
        if (!(guest && left.has(guest.id))) continue;
        const id = `handoff.leave:${task.id}:${guest.id}:${task.handoff?.claimedAt ?? 0}`;
        yield* definition.dispatch({ type: 'handoff.leave', taskId: task.id, guestId: guest.id }, id).pipe(
          Effect.catch((error) =>
            Effect.logWarning('[Handoff] Could not give a task back').pipe(
              Effect.annotateLogs({ taskId: task.id, error: error.message })
            )
          ),
          Effect.forkDetach
        );
      }
    });

    const handle: HandoffsHandle = { link, revoke: definition.removeHandoff, claim, leave };
    return handle;
  });
