import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { requestPromise } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';

export const AccountsHandlers = HttpApiBuilder.group(
  EngineApi,
  'accounts',
  Effect.fn('AccountsHandlers')(function* (handlers) {
    const { accounts: given } = yield* HttpServices;
    const accounts = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const act = <A>(run: (found: NonNullable<typeof given>) => A | PromiseLike<A>) =>
      Effect.flatMap(accounts, (found) => requestPromise(() => Promise.resolve(run(found))));

    return handlers
      .handle('list', () => act((found) => found.snapshot()))
      .handle('refresh', ({ payload }) =>
        act((found) => (payload.scope === 'usage' ? found.refreshUsage() : found.refresh()))
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
