import { Context, Effect, Layer, Ref, type Scope } from 'effect';

export class AccountChanges extends Context.Service<
  AccountChanges,
  {
    readonly notify: Effect.Effect<void>;
    listen(handler: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>;
  }
>()('shinsa/engine/accounts/changes/AccountChanges') {
  static readonly layer = Layer.effect(
    AccountChanges,
    Effect.gen(function* () {
      const handlers = yield* Ref.make<ReadonlySet<Effect.Effect<void>>>(new Set());

      const notify = Effect.gen(function* () {
        for (const handler of yield* Ref.get(handlers)) yield* handler;
      });

      const listen = (handler: Effect.Effect<void>) =>
        Effect.acquireRelease(
          Ref.update(handlers, (all) => new Set(all).add(handler)),
          () => Ref.update(handlers, (all) => new Set([...all].filter((candidate) => candidate !== handler)))
        );

      return AccountChanges.of({ notify, listen });
    })
  );
}
