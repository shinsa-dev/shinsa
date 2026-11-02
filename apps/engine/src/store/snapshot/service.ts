import type { ShinsaState } from '@shinsa/core';
import { Context, Effect, Layer, Option, Result, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { EventRow } from '../events/schema.ts';
import {
  type LogProblem,
  type SnapshotRead,
  SnapshotRow,
  type StateSnapshot,
  StoredProblems,
  StoredState,
} from './schema.ts';

export class Snapshots extends Context.Service<
  Snapshots,
  {
    write(snapshot: StateSnapshot, at: number): Effect.Effect<boolean>;
    select(version: string): Effect.Effect<Option.Option<SnapshotRead>>;
  }
>()('shinsa/engine/store/snapshot/Snapshots') {
  static readonly layer = Layer.effect(
    Snapshots,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const decodeState = Schema.decodeUnknownResult(StoredState);
      const decodeProblems = Schema.decodeUnknownResult(StoredProblems);

      const selectAnchorRow = SqlSchema.findOneOption({
        Request: Schema.Int,
        Result: EventRow,
        execute: (seq) =>
          sql`SELECT seq, at, type, payload FROM events WHERE seq <= ${seq} ORDER BY seq DESC LIMIT 1`,
      });
      const selectLatestRow = SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: SnapshotRow,
        execute: () =>
          sql`SELECT seq, version, anchor, checksum, problems, payload FROM snapshots ORDER BY seq DESC LIMIT 1`,
      });
      const insertRow = SqlSchema.void({
        Request: Schema.Struct({ ...SnapshotRow.fields, at: Schema.Number }),
        execute: (row) => sql`INSERT INTO snapshots ${sql.insert(row)}`,
      });

      const hash = (text: string) => Bun.hash(text).toString(36);

      const resolveAnchor = Effect.fn('Snapshots.resolveAnchor')(function* (seq: number) {
        const row = yield* selectAnchorRow(seq).pipe(Effect.orDie);
        return Option.match(row, {
          onNone: () => '',
          onSome: (event) => hash(`${event.seq}|${event.at}|${event.type}|${event.payload}`),
        });
      });

      const readSnapshot = (row: SnapshotRow): SnapshotRead => {
        const state = decodeState(row.payload);
        const problems = decodeProblems(row.problems);
        if (Result.isFailure(state) || Result.isFailure(problems) || state.success.seq !== row.seq)
          return { ok: false, seq: row.seq, reason: 'unreadable' };
        return {
          ok: true,
          seq: row.seq,
          state: state.success as unknown as ShinsaState,
          problems: problems.success as LogProblem[],
        };
      };

      const verify = (row: SnapshotRow, expected: { version: string; anchor: string }): SnapshotRead => {
        if (row.version !== expected.version) return { ok: false, seq: row.seq, reason: 'version' };
        if (row.anchor !== expected.anchor) return { ok: false, seq: row.seq, reason: 'anchor' };
        if (hash(row.payload) !== row.checksum) return { ok: false, seq: row.seq, reason: 'checksum' };
        return readSnapshot(row);
      };

      const write = Effect.fn('Snapshots.write')(
        function* (snapshot: StateSnapshot, at: number) {
          const anchor = yield* resolveAnchor(snapshot.seq);
          if (snapshot.seq > 0 && anchor === '') return false;
          yield* sql`DELETE FROM snapshots`;
          yield* insertRow({
            seq: snapshot.seq,
            version: snapshot.version,
            anchor,
            checksum: hash(snapshot.payload),
            problems: JSON.stringify(snapshot.problems),
            payload: snapshot.payload,
            at,
          });
          return true;
        },
        (effect) => sql.withTransaction(effect).pipe(Effect.orDie)
      );

      const select = Effect.fn('Snapshots.select')(function* (version: string) {
        const row = yield* selectLatestRow(undefined).pipe(Effect.orDie);
        if (Option.isNone(row)) return Option.none();
        const anchor = yield* resolveAnchor(row.value.seq);
        return Option.some(verify(row.value, { version, anchor }));
      });

      return Snapshots.of({ write, select });
    })
  );
}
