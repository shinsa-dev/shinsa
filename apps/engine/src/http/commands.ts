import {
  DomainError,
  type ScopedActor,
  OWNER_ONLY_CODE,
  parseUserCommand,
  type RequestOrigin,
  resolveFirstName,
  resolveOwnerOnlyRefusal,
  resolveScopedRefusal,
  SCOPE_REFUSAL_CODE,
  type TaskOwner,
  type UserCommand,
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
  readonly guest: ScopedActor | null;
  readonly actor?: TaskOwner | null;
  readonly teams?: Pick<RemoteHandle, 'resolveTeamScope'> | null | undefined;
}

export const resolveTeammateRefusal = Effect.fn('resolveTeammateRefusal')(function* (
  command: UserCommand,
  teams: Pick<RemoteHandle, 'resolveTeamScope'> | null | undefined
) {
  if (command.type !== 'task.hand_to_teammate') return null;
  if (teams && (yield* teams.resolveTeamScope(command.teammate.id, command.teamId))) return null;
  return new DomainError({
    code: 'handoff_refused',
    message: `${resolveFirstName(command.teammate)} is not in that team, so they cannot take this task.`,
  });
});

export const resolveRequestOrigin = Effect.fn('resolveRequestOrigin')(function* (
  source: RequestSourceShape,
  remote: Pick<RemoteHandle, 'isOwner'> | null
) {
  if (source.via === 'local') return 'local' as const;
  if (remote && (yield* remote.isOwner(source.userId))) return 'owner' as const;
  return 'remote' as const;
});

export const resolveRequestActor = Effect.fn('resolveRequestActor')(function* (
  source: RequestSourceShape,
  remote: Pick<RemoteHandle, 'resolveActor'> | null | undefined
) {
  if (source.guest) {
    const { login, name, avatarUrl } = source.guest;
    return { login, name, avatarUrl };
  }
  if (!remote) return null;
  if (source.via === 'local') return yield* remote.resolveActor(null);
  return source.userId ? yield* remote.resolveActor(source.userId) : null;
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
  const stranger = yield* resolveTeammateRefusal(command, source.teams);
  if (stranger) return yield* Effect.fail(resolveRequestFailure(stranger));
  const outside = source.guest ? resolveScopedRefusal(yield* engine.state, source.guest, command) : null;
  if (outside)
    return yield* Effect.fail(
      resolveRequestFailure(new DomainError({ code: SCOPE_REFUSAL_CODE, message: outside }))
    );
  const from = {
    ...(source.clientId ? { id: `client:${source.clientId}` } : {}),
    ...(source.guest ? { guest: source.guest } : {}),
    ...(source.actor ? { actor: source.actor } : {}),
  };
  const events = yield* (
    source.router ? source.router.route(command, from) : engine.dispatch(command, from)
  ).pipe(Effect.mapError(resolveRequestFailure));
  const created = events.find((event) => event.type === 'task.created');
  return created?.type === 'task.created' ? created.taskId : null;
});
