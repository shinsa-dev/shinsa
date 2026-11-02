import { Context, Effect, Exit, Layer, Option, Scope, SynchronizedRef } from 'effect';
import { ACCESS_FINALIZER_STRATEGY, type AccessLease } from './schema.ts';

export class AccessScope extends Context.Service<
  AccessScope,
  {
    acquire(close: Effect.Effect<void>): Effect.Effect<AccessLease>;
    readonly end: Effect.Effect<void>;
    readonly isOpen: Effect.Effect<boolean>;
  }
>()('shinsa/engine/remote/access/AccessScope') {
  static readonly layer = Layer.effect(
    AccessScope,
    Effect.gen(function* () {
      const outer = yield* Effect.scope;
      const current = yield* SynchronizedRef.make(Option.none<Scope.Closeable>());

      const open = SynchronizedRef.modifyEffect(current, (scope) =>
        Option.match(scope, {
          onSome: (opened) => Effect.succeed([opened, scope] as const),
          onNone: () =>
            Scope.fork(outer, ACCESS_FINALIZER_STRATEGY).pipe(
              Effect.map((opened) => [opened, Option.some(opened)] as const)
            ),
        })
      );

      const acquire = Effect.fn('AccessScope.acquire')(function* (close: Effect.Effect<void>) {
        const scope = yield* open;
        const lease = yield* Scope.fork(scope);
        yield* Scope.addFinalizer(lease, close);
        return { release: Scope.close(lease, Exit.void) };
      });

      const end = SynchronizedRef.getAndSet(current, Option.none()).pipe(
        Effect.flatMap((scope) =>
          Option.match(scope, {
            onNone: () => Effect.void,
            onSome: (opened) => Scope.close(opened, Exit.void),
          })
        ),
        Effect.withSpan('AccessScope.end')
      );

      const isOpen = SynchronizedRef.get(current).pipe(Effect.map(Option.isSome));

      return AccessScope.of({ acquire, end, isOpen });
    })
  );
}
