import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const FOCUS_PROJECTS: LogMigration = {
  name: 'focus-projects',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(
        json_remove(payload, '$.focus.projectId'),
        '$.focus.projectIds',
        CASE
          WHEN json_extract(payload, '$.focus.projectId') IS NULL THEN json('[]')
          ELSE json_array(json_extract(payload, '$.focus.projectId'))
        END,
        '$.focus.except',
        json('false')
      )
      WHERE type = 'focus.changed' AND json_type(payload, '$.focus.projectIds') IS NULL`;
  }),
};
