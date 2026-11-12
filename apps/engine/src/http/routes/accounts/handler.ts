import { type AccountsSnapshot, DomainError, OWNER_ONLY_CODE, OWNER_ONLY_MESSAGE } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Accounts } from '../../../accounts/roster/service.ts';
import { Remote } from '../../../remote/machine/service.ts';
import { resolveRequestFailure } from '../../failures.ts';
import { RequestSource } from '../../schema.ts';

export const AccountsHandlers = HttpApiBuilder.group(
  EngineApi,
  'accounts',
  Effect.fn('AccountsHandlers')(function* (handlers) {
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Accounts));
    const remote = Option.getOrNull(yield* Effect.serviceOption(Remote));
    const act = <E>(run: (found: Accounts['Service']) => Effect.Effect<AccountsSnapshot, E>) =>
      given
        ? run(given).pipe(Effect.mapError(resolveRequestFailure))
        : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    const resolveRequester = Effect.fn('AccountsHandlers.resolveRequester')(function* () {
      const { via, userId } = yield* RequestSource;
      if (via === 'local' || !remote || !userId || (yield* remote.isOwner(userId))) return null;
      const member = yield* remote.resolveActor(userId);
      if (member) return member.login;
      return yield* new DomainError({ code: OWNER_ONLY_CODE, message: OWNER_ONLY_MESSAGE });
    });

    const actAs = <E>(
      run: (found: Accounts['Service'], requester: string | null) => Effect.Effect<AccountsSnapshot, E>
    ) =>
      given
        ? resolveRequester().pipe(
            Effect.flatMap((requester) => run(given, requester)),
            Effect.mapError(resolveRequestFailure)
          )
        : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    return handlers
      .handle('list', () => act((found) => found.snapshot))
      .handle('refresh', ({ payload }) =>
        act((found) => (payload.scope === 'usage' ? found.refreshUsage : found.refresh))
      )
      .handle('login', ({ payload }) =>
        actAs((found, requester) => found.startLogin(payload.accountId ?? null, requester))
      )
      .handle('loginCode', ({ payload }) =>
        act((found) => found.submitLoginCode(payload.loginId, payload.code))
      )
      .handle('loginCancel', ({ payload }) => act((found) => found.cancelLogin(payload.loginId)))
      .handle('import', ({ payload }) =>
        actAs((found, requester) => found.importAccount(payload.origin, payload.email, requester))
      )
      .handle('update', ({ payload }) =>
        actAs((found, requester) => found.update(payload.accountId, payload.patch, requester))
      )
      .handle('remove', ({ payload }) =>
        actAs((found, requester) => found.remove(payload.accountId, requester))
      )
      .handle('provider', ({ payload }) =>
        act((found) => found.chooseProvider(payload.provider, payload.choice))
      );
  })
);
