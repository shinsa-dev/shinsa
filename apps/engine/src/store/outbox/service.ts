import {
  EFFECT_RECOVERY,
  type EffectCancellation,
  PROCESS_BOUND_EFFECTS,
  REPLAY_SAFE_EFFECTS,
  resolveEffectKey,
  resolveEffectLane,
  type ShinsaEffect,
} from '@shinsa/core';
import { Context, Effect, Layer, Option, Result, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { StoredJson } from '../events/schema.ts';
import {
  type CancelledEffect,
  ChangedRow,
  ENDED_WITH_PROCESS,
  type EffectEnqueue,
  EffectRow,
  EffectStatus,
  LastEffectIdRow,
  MISMATCHED_EFFECT,
  NextAvailableRow,
  NOT_JSON_EFFECT,
  OpenEffectRow,
  type Reconciled,
  REQUEUED,
  SEED_STRIDE,
  SETTLED_RETENTION_MS,
  StatusRow,
  type StoredEffect,
  StoredEffectPayload,
  UNKNOWN_KIND,
} from './schema.ts';

export class Outbox extends Context.Service<
  Outbox,
  {
    enqueue(input: EffectEnqueue): Effect.Effect<CancelledEffect[]>;
    claim(now: number): Effect.Effect<StoredEffect[]>;
    settle(id: number, now: number): Effect.Effect<boolean>;
    retry(id: number, availableAt: number, error: string): Effect.Effect<boolean>;
    fail(id: number, now: number, error: string): Effect.Effect<boolean>;
    selectStatus(key: string): Effect.Effect<Option.Option<string>>;
    readonly selectNextAvailableAt: Effect.Effect<Option.Option<number>>;
    readonly listStatuses: Effect.Effect<EffectStatus[]>;
    reconcile(now: number): Effect.Effect<Reconciled>;
  }
>()('shinsa/engine/store/outbox/Outbox') {
  static readonly layer = Layer.effect(
    Outbox,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const decodeJson = Schema.decodeUnknownResult(StoredJson);
      const decodePayload = Schema.decodeUnknownResult(StoredEffectPayload);

      const listOpenOfTask = SqlSchema.findAll({
        Request: Schema.Struct({ kinds: Schema.Array(Schema.String), taskId: Schema.String }),
        Result: OpenEffectRow,
        execute: ({ kinds, taskId }) =>
          sql`SELECT id, key, status FROM effects
              WHERE status IN ('pending', 'running') AND kind IN ${sql.in(kinds)}
                AND json_extract(payload, '$.taskId') = ${taskId}
              ORDER BY id`,
      });
      const listOpenOfKinds = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: OpenEffectRow,
        execute: (kinds) =>
          sql`SELECT id, key, status FROM effects
              WHERE status IN ('pending', 'running') AND kind IN ${sql.in(kinds)} ORDER BY id`,
      });
      const markCancelled = SqlSchema.void({
        Request: Schema.Struct({ id: Schema.Int, at: Schema.Number, reason: Schema.String }),
        execute: ({ id, at, reason }) =>
          sql`UPDATE effects SET status = 'cancelled', settled_at = ${at}, last_error = ${reason} WHERE id = ${id}`,
      });
      const selectLastEffectId = SqlSchema.findOne({
        Request: Schema.Void,
        Result: LastEffectIdRow,
        execute: () => sql`SELECT COALESCE(MAX(seq), 0) AS id FROM sqlite_sequence WHERE name = 'effects'`,
      });
      const insertEffect = SqlSchema.void({
        Request: Schema.Struct({
          key: Schema.String,
          lane: Schema.String,
          kind: Schema.String,
          payload: Schema.String,
          status: Schema.Literal('pending'),
          availableAt: Schema.Number,
          createdAt: Schema.Number,
        }),
        execute: (row) => sql`INSERT INTO effects ${sql.insert(row)} ON CONFLICT (key) DO NOTHING`,
      });
      const listClaimable = SqlSchema.findAll({
        Request: Schema.Number,
        Result: EffectRow,
        execute: (now) =>
          sql`SELECT e.id, e.key, e.lane, e.kind, e.payload, e.attempts FROM effects e
              WHERE e.status = 'pending' AND e.available_at <= ${now}
                AND NOT EXISTS (
                  SELECT 1 FROM effects o WHERE o.lane = e.lane AND (
                    o.status = 'running' OR (o.status = 'pending' AND o.id < e.id)
                  )
                )
              ORDER BY e.id`,
      });
      const markRunning = SqlSchema.void({
        Request: Schema.Int,
        execute: (id) => sql`UPDATE effects SET status = 'running', attempts = attempts + 1 WHERE id = ${id}`,
      });
      const markDamaged = SqlSchema.void({
        Request: Schema.Struct({ id: Schema.Int, now: Schema.Number, error: Schema.String }),
        execute: ({ id, now, error }) =>
          sql`UPDATE effects SET status = 'failed', settled_at = ${now}, last_error = ${error} WHERE id = ${id}`,
      });
      const finishSettled = SqlSchema.findAll({
        Request: Schema.Struct({ id: Schema.Int, now: Schema.Number }),
        Result: ChangedRow,
        execute: ({ id, now }) =>
          sql`UPDATE effects SET status = 'done', settled_at = ${now}, last_error = NULL
              WHERE id = ${id} AND status = 'running' RETURNING id`,
      });
      const finishRetried = SqlSchema.findAll({
        Request: Schema.Struct({ id: Schema.Int, availableAt: Schema.Number, error: Schema.String }),
        Result: ChangedRow,
        execute: ({ id, availableAt, error }) =>
          sql`UPDATE effects SET status = 'pending', available_at = ${availableAt}, last_error = ${error}
              WHERE id = ${id} AND status = 'running' RETURNING id`,
      });
      const finishFailed = SqlSchema.findAll({
        Request: Schema.Struct({ id: Schema.Int, now: Schema.Number, error: Schema.String }),
        Result: ChangedRow,
        execute: ({ id, now, error }) =>
          sql`UPDATE effects SET status = 'failed', settled_at = ${now}, last_error = ${error}
              WHERE id = ${id} AND status = 'running' RETURNING id`,
      });
      const selectStatusRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: StatusRow,
        execute: (key) => sql`SELECT status FROM effects WHERE key = ${key}`,
      });
      const selectNextRow = SqlSchema.findOne({
        Request: Schema.Void,
        Result: NextAvailableRow,
        execute: () => sql`SELECT MIN(available_at) AS at FROM effects WHERE status = 'pending'`,
      });
      const listStatusRows = SqlSchema.findAll({
        Request: Schema.Void,
        Result: EffectStatus,
        execute: () => sql`SELECT key, kind, status, attempts FROM effects ORDER BY id`,
      });
      const failUnknown = SqlSchema.findAll({
        Request: Schema.Struct({ now: Schema.Number, known: Schema.Array(Schema.String) }),
        Result: ChangedRow,
        execute: ({ now, known }) =>
          sql`UPDATE effects SET status = 'failed', settled_at = ${now}, last_error = ${UNKNOWN_KIND}
              WHERE status IN ('pending', 'running') AND kind NOT IN ${sql.in(known)} RETURNING id`,
      });
      const requeueSafe = SqlSchema.findAll({
        Request: Schema.Struct({ now: Schema.Number, safe: Schema.Array(Schema.String) }),
        Result: ChangedRow,
        execute: ({ now, safe }) =>
          sql`UPDATE effects SET status = 'pending', available_at = ${now}, last_error = ${REQUEUED}
              WHERE status = 'running' AND kind IN ${sql.in(safe)} RETURNING id`,
      });
      const pruneSettled = SqlSchema.void({
        Request: Schema.Number,
        execute: (before) =>
          sql`DELETE FROM effects WHERE status IN ('done', 'cancelled') AND settled_at < ${before}`,
      });

      const readPayload = (row: EffectRow): Result.Result<ShinsaEffect, string> => {
        const json = decodeJson(row.payload);
        if (Result.isFailure(json)) return Result.fail(`${NOT_JSON_EFFECT}: ${json.failure.message}`);
        const payload = decodePayload(json.success);
        if (Result.isFailure(payload) || payload.success.kind !== row.kind)
          return Result.fail(MISMATCHED_EFFECT);
        return Result.succeed(payload.success as unknown as ShinsaEffect);
      };

      const cancelRows = Effect.fn('Outbox.cancelRows')(function* (
        rows: readonly (typeof OpenEffectRow.Type)[],
        at: number,
        reason: string
      ) {
        for (const row of rows) yield* markCancelled({ id: row.id, at, reason }).pipe(Effect.orDie);
        return rows.map((row): CancelledEffect => ({
          id: row.id,
          key: row.key,
          running: row.status === 'running',
        }));
      });

      const cancel = Effect.fn('Outbox.cancel')(function* (cancellation: EffectCancellation, at: number) {
        const rows = yield* listOpenOfTask({ kinds: cancellation.kinds, taskId: cancellation.taskId }).pipe(
          Effect.orDie
        );
        return yield* cancelRows(rows, at, cancellation.reason);
      });

      const resolveSeed = Effect.fn('Outbox.resolveSeed')(function* (lastSeq: number | null) {
        if (lastSeq !== null) return lastSeq * SEED_STRIDE;
        const row = yield* selectLastEffectId(undefined).pipe(Effect.orDie);
        return -(row.id + 1) * SEED_STRIDE;
      });

      const enqueue = Effect.fn('Outbox.enqueue')(function* (input: EffectEnqueue) {
        const cancelled: CancelledEffect[] = [];
        for (const cancellation of input.cancellations)
          cancelled.push(...(yield* cancel(cancellation, input.at)));
        const seed = yield* resolveSeed(input.lastSeq);
        for (const [index, effect] of input.effects.entries()) {
          yield* insertEffect({
            key: resolveEffectKey(effect, seed + index),
            lane: resolveEffectLane(effect),
            kind: effect.kind,
            payload: JSON.stringify(effect),
            status: 'pending',
            availableAt: input.at,
            createdAt: input.at,
          }).pipe(Effect.orDie);
        }
        return cancelled;
      });

      const claim = Effect.fn('Outbox.claim')(
        function* (now: number) {
          const claimed: StoredEffect[] = [];
          for (let rows = yield* listClaimable(now).pipe(Effect.orDie); rows.length > 0;) {
            for (const row of rows) {
              const effect = readPayload(row);
              if (Result.isFailure(effect)) {
                yield* markDamaged({ id: row.id, now, error: effect.failure }).pipe(Effect.orDie);
                continue;
              }
              yield* markRunning(row.id).pipe(Effect.orDie);
              claimed.push({
                id: row.id,
                key: row.key,
                lane: row.lane,
                effect: effect.success,
                attempts: row.attempts + 1,
              });
            }
            rows = yield* listClaimable(now).pipe(Effect.orDie);
          }
          return claimed;
        },
        (effect) => sql.withTransaction(effect).pipe(Effect.orDie)
      );

      const settle = Effect.fn('Outbox.settle')(function* (id: number, now: number) {
        return (yield* finishSettled({ id, now }).pipe(Effect.orDie)).length > 0;
      });

      const retry = Effect.fn('Outbox.retry')(function* (id: number, availableAt: number, error: string) {
        return (yield* finishRetried({ id, availableAt, error }).pipe(Effect.orDie)).length > 0;
      });

      const fail = Effect.fn('Outbox.fail')(function* (id: number, now: number, error: string) {
        return (yield* finishFailed({ id, now, error }).pipe(Effect.orDie)).length > 0;
      });

      const selectStatus = Effect.fn('Outbox.selectStatus')(function* (key: string) {
        const row = yield* selectStatusRow(key).pipe(Effect.orDie);
        return Option.map(row, ({ status }) => status);
      });

      const reconcile = Effect.fn('Outbox.reconcile')(function* (now: number) {
        const failed = (yield* failUnknown({ now, known: Object.keys(EFFECT_RECOVERY) }).pipe(Effect.orDie))
          .length;
        const bound = yield* listOpenOfKinds([...PROCESS_BOUND_EFFECTS]).pipe(Effect.orDie);
        const cancelled = yield* cancelRows(bound, now, ENDED_WITH_PROCESS);
        const requeued = (yield* requeueSafe({ now, safe: [...REPLAY_SAFE_EFFECTS] }).pipe(Effect.orDie))
          .length;
        yield* pruneSettled(now - SETTLED_RETENTION_MS).pipe(Effect.orDie);
        return { requeued, cancelled, failed };
      });

      return Outbox.of({
        enqueue,
        claim,
        settle,
        retry,
        fail,
        selectStatus,
        selectNextAvailableAt: selectNextRow(undefined).pipe(
          Effect.orDie,
          Effect.map(({ at }) => Option.fromNullishOr(at))
        ),
        listStatuses: listStatusRows(undefined).pipe(Effect.orDie),
        reconcile,
      });
    })
  );
}
