import type { Context } from 'effect';
import type { Briefings } from './briefings/service.ts';
import type { CommandLog } from './commands/service.ts';
import type { Events } from './events/service.ts';
import type { LogMigrator } from './migrations/service.ts';
import type { Outbox } from './outbox/service.ts';
import type { Receipts } from './receipts/service.ts';
import type { Snapshots } from './snapshot/service.ts';

export type LogServices = Events | Outbox | Receipts | Briefings | Snapshots | LogMigrator | CommandLog;

export interface EventLog {
  readonly context: Context.Context<LogServices>;
}
