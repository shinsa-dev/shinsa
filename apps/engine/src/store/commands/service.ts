import { Context, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { Events } from '../events/service.ts';
import { type Reconciled, SETTLED_RETENTION_MS } from '../outbox/schema.ts';
import { Outbox } from '../outbox/service.ts';
import { Receipts } from '../receipts/service.ts';
import type { CommandCommit, CommittedCommand } from './schema.ts';

export class CommandLog extends Context.Service<
  CommandLog,
  {
    commit(input: CommandCommit): Effect.Effect<CommittedCommand>;
    reconcile(now: number): Effect.Effect<Reconciled>;
  }
>()('shinsa/engine/store/commands/CommandLog') {
  static readonly layer = Layer.effect(
    CommandLog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const events = yield* Events;
      const outbox = yield* Outbox;
      const receipts = yield* Receipts;

      const commit = Effect.fn('CommandLog.commit')(
        function* (input: CommandCommit) {
          const stored = yield* events.append(input);
          const cancelled = yield* outbox.enqueue({
            effects: input.effects,
            cancellations: input.cancellations,
            lastSeq: stored.at(-1)?.seq ?? null,
            at: input.at,
          });
          if (input.receipt) {
            yield* receipts.record({
              ...input.receipt,
              status: 'accepted',
              code: null,
              error: null,
              firstSeq: input.fromSeq + 1,
              lastSeq: input.fromSeq + stored.length,
              at: input.at,
            });
          }
          return { events: stored, cancelled };
        },
        (effect) => sql.withTransaction(effect).pipe(Effect.orDie)
      );

      const reconcile = Effect.fn('CommandLog.reconcile')(
        function* (now: number) {
          const reconciled = yield* outbox.reconcile(now);
          yield* receipts.prune(now - SETTLED_RETENTION_MS);
          return reconciled;
        },
        (effect) => sql.withTransaction(effect).pipe(Effect.orDie)
      );

      return CommandLog.of({ commit, reconcile });
    })
  );
}
