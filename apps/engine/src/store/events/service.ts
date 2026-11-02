import type { ShinsaEvent, ShinsaEventInput } from '@shinsa/core';
import { Context, Effect, Layer, Result, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import {
  type EventAppend,
  type EventRead,
  EventRow,
  MISMATCHED_EVENT,
  NOT_JSON_EVENT,
  SeqRange,
  StoredEventPayload,
  StoredJson,
  type UnreadableEvent,
} from './schema.ts';

export class Events extends Context.Service<
  Events,
  {
    read(after: number): Effect.Effect<EventRead>;
    listBetween(firstSeq: number, lastSeq: number): Effect.Effect<ShinsaEvent[]>;
    append(input: EventAppend): Effect.Effect<ShinsaEvent[]>;
  }
>()('shinsa/engine/store/events/Events') {
  static readonly layer = Layer.effect(
    Events,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const decodeJson = Schema.decodeUnknownResult(StoredJson);
      const decodePayload = Schema.decodeUnknownResult(StoredEventPayload);

      const listAfter = SqlSchema.findAll({
        Request: Schema.Int,
        Result: EventRow,
        execute: (after) => sql`SELECT seq, at, type, payload FROM events WHERE seq > ${after} ORDER BY seq`,
      });
      const listRange = SqlSchema.findAll({
        Request: SeqRange,
        Result: EventRow,
        execute: ({ firstSeq, lastSeq }) =>
          sql`SELECT seq, at, type, payload FROM events WHERE seq BETWEEN ${firstSeq} AND ${lastSeq} ORDER BY seq`,
      });
      const insertRow = SqlSchema.void({
        Request: EventRow,
        execute: (row) => sql`INSERT INTO events ${sql.insert(row)}`,
      });

      const readPayload = (row: EventRow): Result.Result<ShinsaEventInput, string> => {
        const json = decodeJson(row.payload);
        if (Result.isFailure(json)) return Result.fail(`${NOT_JSON_EVENT}: ${json.failure.message}`);
        const payload = decodePayload(json.success);
        if (Result.isFailure(payload) || payload.success.type !== row.type)
          return Result.fail(MISMATCHED_EVENT);
        return Result.succeed(payload.success as unknown as ShinsaEventInput);
      };

      const readRows = (rows: readonly EventRow[]): EventRead => {
        const events: ShinsaEvent[] = [];
        const unreadable: UnreadableEvent[] = [];
        for (const row of rows) {
          const payload = readPayload(row);
          if (Result.isFailure(payload))
            unreadable.push({ seq: row.seq, type: row.type, error: payload.failure });
          else events.push({ ...payload.success, seq: row.seq, at: row.at } as ShinsaEvent);
        }
        return { events, unreadable, lastSeq: rows.at(-1)?.seq ?? 0 };
      };

      const read = Effect.fn('Events.read')(function* (after: number) {
        const rows = yield* listAfter(after).pipe(Effect.orDie);
        const found = readRows(rows);
        return { ...found, lastSeq: Math.max(found.lastSeq, after) };
      });

      const listBetween = Effect.fn('Events.listBetween')(function* (firstSeq: number, lastSeq: number) {
        const rows = yield* listRange({ firstSeq, lastSeq }).pipe(Effect.orDie);
        return readRows(rows).events;
      });

      const append = Effect.fn('Events.append')(function* ({ events, fromSeq, at }: EventAppend) {
        const stored = events.map(
          (event, index) => ({ ...event, seq: fromSeq + index + 1, at }) as ShinsaEvent
        );
        for (const event of stored) {
          const { seq, at: _at, ...payload } = event;
          yield* insertRow({ seq, at, type: event.type, payload: JSON.stringify(payload) }).pipe(
            Effect.orDie
          );
        }
        return stored;
      });

      return Events.of({ read, listBetween, append });
    })
  );
}
