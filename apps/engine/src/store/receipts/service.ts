import { Context, Effect, Layer, type Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { CommandReceipt } from './schema.ts';

export class Receipts extends Context.Service<
  Receipts,
  {
    record(receipt: CommandReceipt): Effect.Effect<void>;
    select(id: string): Effect.Effect<Option.Option<CommandReceipt>>;
    prune(before: number): Effect.Effect<void>;
  }
>()('shinsa/engine/store/receipts/Receipts') {
  static readonly layer = Layer.effect(
    Receipts,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const insertRow = SqlSchema.void({
        Request: CommandReceipt,
        execute: (row) => sql`INSERT INTO receipts ${sql.insert(row)} ON CONFLICT (id) DO NOTHING`,
      });
      const selectRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: CommandReceipt,
        execute: (id) => sql`SELECT * FROM receipts WHERE id = ${id}`,
      });
      const pruneRows = SqlSchema.void({
        Request: Schema.Number,
        execute: (before) => sql`DELETE FROM receipts WHERE at < ${before}`,
      });

      return Receipts.of({
        record: (receipt) => insertRow(receipt).pipe(Effect.orDie),
        select: (id) => selectRow(id).pipe(Effect.orDie),
        prune: (before) => pruneRows(before).pipe(Effect.orDie),
      });
    })
  );
}
