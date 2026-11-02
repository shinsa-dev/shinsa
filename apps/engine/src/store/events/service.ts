import type { ShinsaEvent, ShinsaEventInput } from '@shinsa/core';
import { Context, Effect, Layer, Result, Schema } from 'effect';
import { isReadonlyArrayNonEmpty, map } from 'effect/Array';
import { SqlClient, SqlSchema } from 'effect/sql';
import { readStoredPayload } from '../shared/payload.ts';
import {
  EVENT_PAYLOAD_MESSAGES,
  type EventAppend,
  type EventRead,
  EventRow,
  EventRows,
  SeqRange,
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
      const insertRows = SqlSchema.void({
        Request: EventRows,
        execute: (rows) => sql`INSERT INTO events ${sql.insert(rows)}`,
      });

      const readRows = (rows: readonly EventRow[]): EventRead => {
        const events: ShinsaEvent[] = [];
        const unreadable: UnreadableEvent[] = [];
        for (const row of rows) {
          const payload = readStoredPayload(row.payload, 'type', row.type, EVENT_PAYLOAD_MESSAGES);
          if (Result.isFailure(payload))
            unreadable.push({ seq: row.seq, type: row.type, error: payload.failure });
          else
            events.push({
              ...(payload.success as unknown as ShinsaEventInput),
              seq: row.seq,
              at: row.at,
            } as ShinsaEvent);
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
        if (!isReadonlyArrayNonEmpty(stored)) return stored;
        const rows = map(stored, ({ seq, at: _at, ...payload }) => ({
          seq,
          at,
          type: payload.type,
          payload: JSON.stringify(payload),
        }));
        yield* insertRows(rows).pipe(Effect.orDie);
        return stored;
      });

      return Events.of({ read, listBetween, append });
    })
  );
}
