import { type AccountsSnapshot } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Accounts } from '../../../accounts/roster/service.ts';
import { resolveRequestFailure } from '../../failures.ts';

export const AccountsHandlers = HttpApiBuilder.group(
  EngineApi,
  'accounts',
  Effect.fn('AccountsHandlers')(function* (handlers) {
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Accounts));
    const act = <E>(run: (found: Accounts['Service']) => Effect.Effect<AccountsSnapshot, E>) =>
      given
        ? run(given).pipe(Effect.mapError(resolveRequestFailure))
        : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));

    return handlers
      .handle('list', () => act((found) => found.snapshot))
      .handle('refresh', ({ payload }) =>
        act((found) => (payload.scope === 'usage' ? found.refreshUsage : found.refresh))
      )
      .handle('login', ({ payload }) => act((found) => found.startLogin(payload.accountId ?? null)))
      .handle('loginCode', ({ payload }) =>
        act((found) => found.submitLoginCode(payload.loginId, payload.code))
      )
      .handle('loginCancel', ({ payload }) => act((found) => found.cancelLogin(payload.loginId)))
      .handle('import', ({ payload }) => act((found) => found.importAccount(payload.origin, payload.email)))
      .handle('update', ({ payload }) => act((found) => found.update(payload.accountId, payload.patch)))
      .handle('remove', ({ payload }) => act((found) => found.remove(payload.accountId)));
  })
);
