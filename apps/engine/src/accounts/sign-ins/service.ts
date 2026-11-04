import { Context, Effect, Layer, Ref } from 'effect';
import type { SignInState } from '../schema.ts';

export class AccountSignIns extends Context.Service<
  AccountSignIns,
  {
    select(accountId: string): Effect.Effect<SignInState | null>;
    record(accountId: string, state: SignInState): Effect.Effect<void>;
    remove(accountId: string): Effect.Effect<void>;
  }
>()('shinsa/engine/accounts/sign-ins/AccountSignIns') {
  static readonly layer = Layer.effect(
    AccountSignIns,
    Effect.gen(function* () {
      const states = yield* Ref.make<ReadonlyMap<string, SignInState>>(new Map());

      const select = (accountId: string) => Effect.map(Ref.get(states), (all) => all.get(accountId) ?? null);

      const record = (accountId: string, state: SignInState) =>
        Ref.update(states, (all) => new Map(all).set(accountId, state));

      const remove = (accountId: string) =>
        Ref.update(states, (all) => {
          const rest = new Map(all);
          rest.delete(accountId);
          return rest;
        });

      return AccountSignIns.of({ select, record, remove });
    })
  );
}
