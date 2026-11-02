import {
  DomainError,
  type GuestActor,
  LOCAL_ONLY_CODE,
  parseUserCommand,
  type RequestOrigin,
  resolveLocalOnlyRefusal,
  resolveScopedRefusal,
  SCOPE_REFUSAL_CODE,
} from '@shinsa/core';
import { Effect, Result } from 'effect';
import { createReadOnlyError } from '../instance/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { type Classifier, routeUserCommand } from '../triage/message.ts';
import { requestPromise, resolveRequestFailure } from './failures.ts';

export interface UserCommandSource {
  readonly clientId: string | null;
  readonly classify: Classifier | null;
  readonly origin: RequestOrigin;
  readonly guest: GuestActor | null;
}

export const dispatchUserCommand = Effect.fn('dispatchUserCommand')(function* (
  engine: Engine,
  body: unknown,
  source: UserCommandSource
) {
  if (engine.readOnly) return yield* Effect.fail(resolveRequestFailure(createReadOnlyError()));
  const parsed = parseUserCommand(body);
  if (Result.isFailure(parsed)) return yield* Effect.fail(resolveRequestFailure(parsed.failure));
  const command = parsed.success;
  const refusal = resolveLocalOnlyRefusal(source.origin, command);
  if (refusal)
    return yield* Effect.fail(
      resolveRequestFailure(new DomainError({ code: LOCAL_ONLY_CODE, message: refusal }))
    );
  const outside = source.guest ? resolveScopedRefusal(engine.state, source.guest.taskId, command) : null;
  if (outside)
    return yield* Effect.fail(
      resolveRequestFailure(new DomainError({ code: SCOPE_REFUSAL_CODE, message: outside }))
    );
  const events = yield* requestPromise(() =>
    routeUserCommand(
      engine,
      command,
      source.clientId ? `client:${source.clientId}` : null,
      source.classify,
      source.guest ? { guest: source.guest } : {}
    )
  );
  const created = events.find((event) => event.type === 'task.created');
  return created?.type === 'task.created' ? created.taskId : null;
});
