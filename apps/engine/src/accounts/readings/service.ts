import { Clock, Context, Effect, Layer, Ref } from 'effect';
import { StoredLogins } from '../credentials/service.ts';
import {
  AccountsInput,
  AccountStepFailed,
  EXPIRED_DETAIL,
  type ProviderIdentity,
  type UsageRead,
} from '../schema.ts';
import { AccountStore } from '../store/service.ts';
import { UsageApi } from '../usage/service.ts';

export class UsageReadings extends Context.Service<
  UsageReadings,
  {
    readonly providerIds: readonly string[];
    readAccount(accountId: string): Effect.Effect<UsageRead, AccountStepFailed>;
    readProvider(provider: string): Effect.Effect<UsageRead, AccountStepFailed>;
    selectProviderIdentity(provider: string): Effect.Effect<ProviderIdentity | null>;
  }
>()('shinsa/engine/accounts/readings/UsageReadings') {
  static readonly layer = Layer.effect(
    UsageReadings,
    Effect.gen(function* () {
      const store = yield* AccountStore;
      const logins = yield* StoredLogins;
      const usage = yield* UsageApi;
      const input = yield* AccountsInput;
      const sources = new Map(input.usageSources.map((source) => [source.id, source]));
      const identities = yield* Ref.make<ReadonlyMap<string, ProviderIdentity>>(new Map());

      const requestUsage = (accessToken: string) =>
        usage.request(accessToken).pipe(
          Effect.map((answer): UsageRead => ({ ok: true, ...answer })),
          Effect.catchTag('UsageReadFailed', (failed) =>
            Effect.succeed<UsageRead>({
              ok: false,
              reason: failed.reason,
              detail: failed.detail,
              retryAfterMs: failed.retryAfterMs,
            })
          )
        );

      const readAccount = Effect.fn('UsageReadings.readAccount')(function* (accountId: string) {
        const account = yield* store.select(accountId);
        if (!account) {
          const removed: UsageRead = {
            ok: false,
            reason: 'failed',
            detail: 'The account was removed.',
            retryAfterMs: null,
          };
          return removed;
        }
        const login = yield* logins.read(account.configDir);
        if (!login) {
          const missing: UsageRead = {
            ok: false,
            reason: 'expired',
            detail: 'Shinsa could not find this account’s login. Sign in again.',
            retryAfterMs: null,
          };
          return missing;
        }
        if (login.plan && !account.plan) yield* store.update(account.id, { plan: login.plan });
        if (login.expiresAt !== null && login.expiresAt <= (yield* Clock.currentTimeMillis)) {
          const expired: UsageRead = {
            ok: false,
            reason: 'expired',
            detail: EXPIRED_DETAIL,
            retryAfterMs: null,
          };
          return expired;
        }
        return yield* requestUsage(login.accessToken);
      });

      const readProvider = Effect.fn('UsageReadings.readProvider')(function* (provider: string) {
        const source = yield* Effect.orDie(Effect.fromNullishOr(sources.get(provider)));
        const reading = yield* source.read.pipe(
          Effect.mapError((failure) => new AccountStepFailed({ message: failure.message }))
        );
        yield* Ref.update(identities, (all) => {
          const known = all.get(provider);
          return new Map(all).set(provider, {
            email: reading.email ?? known?.email ?? null,
            plan: reading.plan ?? known?.plan ?? null,
          });
        });
        return reading.read;
      });

      const selectProviderIdentity = (provider: string) =>
        Effect.map(Ref.get(identities), (all) => all.get(provider) ?? null);

      return UsageReadings.of({
        providerIds: [...sources.keys()],
        readAccount,
        readProvider,
        selectProviderIdentity,
      });
    })
  );
}
