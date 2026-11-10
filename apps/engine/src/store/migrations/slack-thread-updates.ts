import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const SLACK_THREAD_UPDATES: LogMigration = {
  name: 'slack-thread-updates',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(payload, '$.schedule.trigger.threadUpdates', json('true'))
      WHERE type = 'schedule.written'
        AND json_extract(payload, '$.schedule.trigger.kind') = 'slack'
        AND json_type(payload, '$.schedule.trigger.threadUpdates') IS NULL`;
  }),
};
