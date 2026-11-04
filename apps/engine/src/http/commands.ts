import {
  DomainError,
  type GuestActor,
  OWNER_ONLY_CODE,
  parseUserCommand,
  type RequestOrigin,
  resolveOwnerOnlyRefusal,
  resolveScopedRefusal,
  SCOPE_REFUSAL_CODE,
} from '@shinsa/core';
import { Effect, Result } from 'effect';
import { createReadOnlyError } from '../instance/index.ts';
import type { RemoteHandle } from '../remote/machine/schema.ts';
import type { EngineCore } from '../runtime/engine/service.ts';
import type { CommandRouter } from '../triage/index.ts';
import { resolveRequestFailure } from './failures.ts';
import type { RequestSourceShape } from './schema.ts';

export interface UserCommandSource {
  readonly clientId: string | null;
  readonly router: CommandRouter['Service'] | null;
  readonly origin: RequestOrigin;
  readonly guest: GuestActor | null;
}

export const resolveRequestOrigin = Effect.fn('resolveRequestOrigin')(function* (
  source: RequestSourceShape,
  remote: Pick<RemoteHandle, 'isOwner'> | null
) {
  if (source.via === 'local') return 'local' as const;
  if (remote && (yield* remote.isOwner(source.userId))) return 'owner' as const;
  return 'remote' as const;
});

export const dispatchUserCommand = Effect.fn('dispatchUserCommand')(function* (
  engine: EngineCore['Service'],
  body: unknown,
  source: UserCommandSource
) {
  if (engine.readOnly) return yield* Effect.fail(resolveRequestFailure(createReadOnlyError()));
  const parsed = parseUserCommand(body);
  if (Result.isFailure(parsed)) return yield* Effect.fail(resolveRequestFailure(parsed.failure));
  const command = parsed.success;
  const refusal = resolveOwnerOnlyRefusal(source.origin, command);
  if (refusal)
    return yield* Effect.fail(
      resolveRequestFailure(new DomainError({ code: OWNER_ONLY_CODE, message: refusal }))
    );
  const outside = source.guest
    ? resolveScopedRefusal(yield* engine.state, source.guest.taskId, command)
    : null;
  if (outside)
    return yield* Effect.fail(
      resolveRequestFailure(new DomainError({ code: SCOPE_REFUSAL_CODE, message: outside }))
    );
  const id = source.clientId ? `client:${source.clientId}` : null;
  const from = source.guest ? { guest: source.guest } : {};
  const events = yield* (
    source.router
      ? source.router.route(command, id, from)
      : engine.dispatch(command, id ? { ...from, id } : from)
  ).pipe(Effect.mapError(resolveRequestFailure));
  const created = events.find((event) => event.type === 'task.created');
  return created?.type === 'task.created' ? created.taskId : null;
});
