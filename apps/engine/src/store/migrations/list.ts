import { LOG_BASELINE, type LogMigration } from './schema.ts';
import { SLACK_CHANNEL_NAMES } from './slack-channel-names.ts';
import { STACK_LISTS } from './stack-lists.ts';

export const LOG_MIGRATIONS: readonly LogMigration[] = [STACK_LISTS, SLACK_CHANNEL_NAMES];

export function resolveLogVersion(migrations: readonly LogMigration[] = LOG_MIGRATIONS) {
  return LOG_BASELINE + migrations.length;
}
