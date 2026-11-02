import { SqliteClient } from '@effect/sql-sqlite-bun';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { Briefings } from './briefings/service.ts';
import { CommandLog } from './commands/service.ts';
import { Events } from './events/service.ts';
import { LOG_MIGRATIONS } from './migrations/list.ts';
import { LogMigrator } from './migrations/service.ts';
import { Outbox } from './outbox/service.ts';
import { Receipts } from './receipts/service.ts';
import { SQL_NAMES } from './shared/schema.ts';
import { Snapshots } from './snapshot/service.ts';

const LogTables = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA synchronous = NORMAL`;
    yield* sql`CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL)`;
    yield* sql`CREATE TABLE IF NOT EXISTS effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      lane TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      settled_at INTEGER
    )`;
    yield* sql`CREATE INDEX IF NOT EXISTS effects_open ON effects (status, lane, id)`;
    yield* sql`CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      target TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      code TEXT,
      error TEXT,
      first_seq INTEGER NOT NULL,
      last_seq INTEGER NOT NULL,
      at INTEGER NOT NULL
    )`;
    yield* sql`CREATE INDEX IF NOT EXISTS receipts_at ON receipts (at)`;
    yield* sql`CREATE TABLE IF NOT EXISTS snapshots (
      seq INTEGER PRIMARY KEY,
      version TEXT NOT NULL,
      anchor TEXT NOT NULL,
      checksum TEXT NOT NULL,
      problems TEXT NOT NULL,
      payload TEXT NOT NULL,
      at INTEGER NOT NULL
    )`;
    yield* sql`CREATE TABLE IF NOT EXISTS briefings (project TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL)`;
  })
);

const StampedLog = Layer.effectDiscard(LogMigrator.use((migrator) => migrator.stamp(LOG_MIGRATIONS)));

function LogDatabase(filename: string) {
  return LogTables.pipe(Layer.provideMerge(SqliteClient.layer({ filename, create: true, ...SQL_NAMES })));
}

export function StoreLayer(filename: string) {
  const services = Layer.mergeAll(
    Events.layer,
    Outbox.layer,
    Receipts.layer,
    Briefings.layer,
    Snapshots.layer,
    LogMigrator.layer
  );
  return StampedLog.pipe(
    Layer.provideMerge(Layer.provideMerge(CommandLog.layer, services)),
    Layer.provideMerge(LogDatabase(filename)),
    Layer.orDie
  );
}
