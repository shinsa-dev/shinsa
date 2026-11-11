import { FOCUS_PROJECTS } from './focus-projects.ts';
import { PROPOSAL_RECOMMEND } from './proposal-recommend.ts';
import { RESET_PACES } from './reset-paces.ts';
import { REVIEW_SEEN } from './review-seen.ts';
import { LOG_BASELINE, type LogMigration } from './schema.ts';
import { SHARE_SCOPES } from './share-scopes.ts';
import { SLACK_CHANNEL_NAMES } from './slack-channel-names.ts';
import { SLACK_THREAD_UPDATES } from './slack-thread-updates.ts';
import { STACK_LISTS } from './stack-lists.ts';
import { TASK_AUTO_PROJECT } from './task-auto-project.ts';

export const LOG_MIGRATIONS: readonly LogMigration[] = [
  STACK_LISTS,
  SLACK_CHANNEL_NAMES,
  REVIEW_SEEN,
  SHARE_SCOPES,
  PROPOSAL_RECOMMEND,
  TASK_AUTO_PROJECT,
  FOCUS_PROJECTS,
  SLACK_THREAD_UPDATES,
  RESET_PACES,
];

export function resolveLogVersion(migrations: readonly LogMigration[] = LOG_MIGRATIONS) {
  return LOG_BASELINE + migrations.length;
}
