import { Context, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { resolveLogVersion } from './list.ts';
import { AnyEventRow, LOG_BASELINE, type LogMigration, LogVersionError, UserVersionRow } from './schema.ts';

export class LogMigrator extends Context.Service<
  LogMigrator,
  {
    stamp(migrations: readonly LogMigration[]): Effect.Effect<void>;
    assertCurrent(migrations: readonly LogMigration[]): Effect.Effect<void, LogVersionError>;
    migrate(migrations: readonly LogMigration[]): Effect.Effect<string[], LogVersionError>;
  }
>()('shinsa/engine/store/migrations/LogMigrator') {
  static readonly layer = Layer.effect(
    LogMigrator,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const selectVersionRow = SqlSchema.findOne({
        Request: Schema.Void,
        Result: UserVersionRow,
        execute: () => sql`PRAGMA user_version`,
      });
      const selectAnyEvent = SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: AnyEventRow,
        execute: () => sql`SELECT seq FROM events LIMIT 1`,
      });

      const selectVersion = selectVersionRow(undefined).pipe(
        Effect.orDie,
        Effect.map(({ userVersion }) => userVersion)
      );

      const writeVersion = (version: number) =>
        sql`PRAGMA user_version = ${sql.literal(String(Math.trunc(version)))}`;

      const assertReadable = Effect.fn('LogMigrator.assertReadable')(function* (version: number) {
        if (version >= LOG_BASELINE) return;
        return yield* new LogVersionError({
          message: `This event log is at version ${version}, from a Shinsa older than any this one reads (${LOG_BASELINE} and later). Move the data folder aside and start Shinsa again to begin a new log.`,
          version,
        });
      });

      const listPending = (version: number, migrations: readonly LogMigration[]) =>
        migrations.slice(Math.max(0, version - LOG_BASELINE));

      const stamp = Effect.fn('LogMigrator.stamp')(function* (migrations: readonly LogMigration[]) {
        if ((yield* selectVersion) !== 0) return;
        if (Option.isSome(yield* selectAnyEvent(undefined).pipe(Effect.orDie))) return;
        yield* writeVersion(resolveLogVersion(migrations)).pipe(Effect.orDie);
      });

      const assertCurrent = Effect.fn('LogMigrator.assertCurrent')(function* (
        migrations: readonly LogMigration[]
      ) {
        const version = yield* selectVersion;
        yield* assertReadable(version);
        if (listPending(version, migrations).length === 0) return;
        return yield* new LogVersionError({
          message: `This event log is at version ${version} and needs migrating to version ${resolveLogVersion(migrations)}. Open it once with a Shinsa that can write to it, then inspect it again.`,
          version,
        });
      });

      const migrate = Effect.fn('LogMigrator.migrate')(function* (migrations: readonly LogMigration[]) {
        const version = yield* selectVersion;
        yield* assertReadable(version);
        const pending = listPending(version, migrations);
        if (pending.length === 0) return [];
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* Effect.forEach(pending, (migration) => migration.migrate, { discard: true }).pipe(
                Effect.provideService(SqlClient.SqlClient, sql)
              );
              yield* sql`DELETE FROM snapshots`;
              yield* writeVersion(resolveLogVersion(migrations));
            })
          )
          .pipe(Effect.orDie);
        return pending.map((migration) => migration.name);
      });

      return LogMigrator.of({ stamp, assertCurrent, migrate });
    })
  );
}
