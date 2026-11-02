import { LOG_BASELINE, type LogMigration } from './schema.ts';

export const LOG_MIGRATIONS: readonly LogMigration[] = [];

export function resolveLogVersion(migrations: readonly LogMigration[] = LOG_MIGRATIONS) {
  return LOG_BASELINE + migrations.length;
}
