import { DomainError, type ShinsaCommand, type TaskGuest } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { describeError } from '../../log/redact.ts';
import type { EffectAttempt } from '../../runtime/engine/schema.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { EffectFailed } from '../../runtime/failures/schema.ts';
import { Remote } from '../machine/service.ts';
import { CLAIM_FAILED, HandoffCallFailed, HandoffCommandFailed, type HandoffsHandle } from './schema.ts';

export class Handoffs extends Context.Service<Handoffs, HandoffsHandle>()(
  'shinsa/engine/remote/handoffs/Handoffs'
) {
  static readonly layer = Layer.effect(
    Handoffs,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const remote = yield* Remote;

      const failLink = (message: string, retryable: boolean) =>
        Effect.fail(new EffectFailed({ message, detail: message, retryable, delayMs: null }));

      const toCallFailure = (error: unknown) => new HandoffCallFailed({ message: describeError(error) });

      const dispatch = (command: ShinsaCommand, id?: string) =>
        engine.dispatch(command, id === undefined ? {} : { id }).pipe(
          Effect.asVoid,
          Effect.catchTag('EngineStopped', (error) =>
            Effect.fail(new HandoffCommandFailed({ message: error.message }))
          )
        );

      const link = Effect.fn('Handoffs.link')(function* (taskId: string, attempt: EffectAttempt) {
        const handoff = (yield* engine.state).tasks[taskId]?.handoff;
        if (!handoff || handoff.guest) return;
        const url = yield* remote
          .createHandoff(taskId)
          .pipe(
            Effect.catch((error) =>
              error instanceof DomainError
                ? failLink(error.message, false)
                : failLink(describeError(error), true)
            )
          );
        yield* dispatch({ type: 'handoff.record', taskId, url }, `${attempt.key}:handoff.record`).pipe(
          Effect.catchTags({
            DomainError: (error) => failLink(error.message, true),
            HandoffCommandFailed: (error) => failLink(error.message, true),
          })
        );
      });

      const revoke = (taskId: string, guestId: string | null) =>
        remote.removeHandoff(taskId, guestId).pipe(Effect.mapError(toCallFailure));

      const claim = Effect.fn('Handoffs.claim')(function* (taskId: string, user: TaskGuest) {
        const guest = { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl };
        return yield* dispatch({ type: 'handoff.claim', taskId, guest }).pipe(
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
        for (const task of Object.values((yield* engine.state).tasks)) {
          const guest = task.handoff?.guest;
          if (!(guest && left.has(guest.id))) continue;
          const id = `handoff.leave:${task.id}:${guest.id}:${task.handoff?.claimedAt ?? 0}`;
          yield* dispatch({ type: 'handoff.leave', taskId: task.id, guestId: guest.id }, id).pipe(
            Effect.catch((error) =>
              Effect.logWarning('[Handoff] Could not give a task back').pipe(
                Effect.annotateLogs({ taskId: task.id, error: error.message })
              )
            ),
            Effect.forkDetach
          );
        }
      });

      yield* remote.handleClaims(claim);
      yield* remote.handleLeaves(leave);

      return Handoffs.of({ link, revoke });
    })
  );
}
