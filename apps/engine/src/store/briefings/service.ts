import type { Briefing, StoredBriefing } from '@shinsa/core';
import { Context, Effect, Layer, Option, Predicate, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { BriefingRow, type KeyedBriefing, StoredBriefingPayload } from './schema.ts';

export class Briefings extends Context.Service<
  Briefings,
  {
    readonly list: Effect.Effect<KeyedBriefing[]>;
    write(key: string, stored: StoredBriefing): Effect.Effect<void>;
  }
>()('shinsa/engine/store/briefings/Briefings') {
  static readonly layer = Layer.effect(
    Briefings,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const decodePayload = Schema.decodeUnknownOption(StoredBriefingPayload);

      const listRows = SqlSchema.findAll({
        Request: Schema.Void,
        Result: BriefingRow,
        execute: () => sql`SELECT project, payload FROM briefings ORDER BY project`,
      });
      const upsertRow = SqlSchema.void({
        Request: Schema.Struct({ project: Schema.String, at: Schema.Number, payload: Schema.String }),
        execute: (row) =>
          sql`INSERT INTO briefings ${sql.insert(row)}
              ON CONFLICT (project) DO UPDATE SET at = excluded.at, payload = excluded.payload`,
      });

      const readBriefing = (row: typeof BriefingRow.Type) =>
        Option.map(decodePayload(row.payload), (value): KeyedBriefing => ({
          key: row.project,
          stored: {
            text: value.text,
            at: value.at,
            briefing: Predicate.isObject(value.briefing) ? (value.briefing as unknown as Briefing) : null,
          },
        }));

      const list = listRows(undefined).pipe(
        Effect.orDie,
        Effect.map((rows) => rows.flatMap((row) => Option.toArray(readBriefing(row))))
      );

      const write = Effect.fn('Briefings.write')(function* (key: string, stored: StoredBriefing) {
        yield* upsertRow({
          project: key,
          at: stored.at,
          payload: JSON.stringify(stored),
        }).pipe(Effect.orDie);
      });

      return Briefings.of({ list, write });
    })
  );
}
