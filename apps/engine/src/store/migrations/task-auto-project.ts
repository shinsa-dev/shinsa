import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const TASK_AUTO_PROJECT: LogMigration = {
  name: 'task-auto-project',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(payload, '$.auto.project', json('false'))
      WHERE type = 'task.created' AND json_type(payload, '$.auto.project') IS NULL`;
  }),
};
