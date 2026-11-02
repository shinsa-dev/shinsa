import type { Database } from 'bun:sqlite';

export interface LogMigration {
  readonly name: string;
  readonly migrate: (db: Database) => void;
}

export const LOG_BASELINE = 15;

export const LOG_MIGRATIONS: readonly LogMigration[] = [];

export class LogVersionError extends Error {
  constructor(
    message: string,
    readonly version: number
  ) {
    super(message);
    this.name = 'LogVersionError';
  }
}

export function resolveLogVersion(migrations: readonly LogMigration[] = LOG_MIGRATIONS) {
  return LOG_BASELINE + migrations.length;
}

export function selectLogVersion(db: Database) {
  return db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
}

function writeLogVersion(db: Database, version: number) {
  db.run(`PRAGMA user_version = ${version}`);
}

function isEmptyLog(db: Database) {
  return db.query<{ seq: number }, []>('SELECT seq FROM events LIMIT 1').get() === null;
}

export function stampEmptyLog(db: Database, migrations: readonly LogMigration[] = LOG_MIGRATIONS) {
  if (selectLogVersion(db) === 0 && isEmptyLog(db)) writeLogVersion(db, resolveLogVersion(migrations));
}

function assertReadableVersion(version: number) {
  if (version >= LOG_BASELINE) return;
  throw new LogVersionError(
    `This event log is at version ${version}, from a Shinsa older than any this one reads (${LOG_BASELINE} and later). Move the data folder aside and start Shinsa again to begin a new log.`,
    version
  );
}

function listPendingMigrations(version: number, migrations: readonly LogMigration[]) {
  return migrations.slice(Math.max(0, version - LOG_BASELINE));
}

export function assertCurrentLog(db: Database, migrations: readonly LogMigration[] = LOG_MIGRATIONS) {
  const version = selectLogVersion(db);
  assertReadableVersion(version);
  if (listPendingMigrations(version, migrations).length === 0) return;
  throw new LogVersionError(
    `This event log is at version ${version} and needs migrating to version ${resolveLogVersion(migrations)}. Open it once with a Shinsa that can write to it, then inspect it again.`,
    version
  );
}

export function migrateLog(db: Database, migrations: readonly LogMigration[] = LOG_MIGRATIONS) {
  const version = selectLogVersion(db);
  assertReadableVersion(version);
  const pending = listPendingMigrations(version, migrations);
  if (pending.length === 0) return [];
  db.transaction(() => {
    for (const migration of pending) migration.migrate(db);
    db.run('DELETE FROM snapshots');
    writeLogVersion(db, resolveLogVersion(migrations));
  })();
  return pending.map((migration) => migration.name);
}
