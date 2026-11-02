import { type Briefing, briefingKey, type StoredBriefing } from '@shinsa/core';
import { Context, Effect, Layer, Option, Predicate, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { BriefingRow, type ProjectBriefing, StoredBriefingPayload } from './schema.ts';

export class Briefings extends Context.Service<
  Briefings,
  {
    readonly list: Effect.Effect<ProjectBriefing[]>;
    write(projectId: string | null, stored: StoredBriefing): Effect.Effect<void>;
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
        execute: () => sql`SELECT payload FROM briefings ORDER BY project`,
      });
      const upsertRow = SqlSchema.void({
        Request: Schema.Struct({ project: Schema.String, at: Schema.Number, payload: Schema.String }),
        execute: (row) =>
          sql`INSERT INTO briefings ${sql.insert(row)}
              ON CONFLICT (project) DO UPDATE SET at = excluded.at, payload = excluded.payload`,
      });

      const readBriefing = (payload: string) =>
        Option.map(decodePayload(payload), (value): ProjectBriefing => ({
          projectId: Predicate.isString(value.projectId) ? value.projectId : null,
          stored: {
            text: value.text,
            at: value.at,
            briefing: Predicate.isObject(value.briefing) ? (value.briefing as unknown as Briefing) : null,
          },
        }));

      const list = listRows(undefined).pipe(
        Effect.orDie,
        Effect.map((rows) => rows.flatMap((row) => Option.toArray(readBriefing(row.payload))))
      );

      const write = Effect.fn('Briefings.write')(function* (
        projectId: string | null,
        stored: StoredBriefing
      ) {
        yield* upsertRow({
          project: briefingKey(projectId),
          at: stored.at,
          payload: JSON.stringify({ projectId, ...stored }),
        }).pipe(Effect.orDie);
      });

      return Briefings.of({ list, write });
    })
  );
}
