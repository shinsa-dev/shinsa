import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const STACK_LISTS: LogMigration = {
  name: 'stack-lists',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(
        payload,
        '$.stacksOn',
        CASE WHEN json_extract(payload, '$.stacksOn') IS NULL THEN json('[]')
          ELSE json_array(json_extract(payload, '$.stacksOn')) END
      )
      WHERE type = 'task.stack_changed' AND json_type(payload, '$.stacksOn') IS NOT 'array'`;
    yield* sql`UPDATE events
      SET payload = json_remove(
        json_set(
          payload,
          '$.bases',
          CASE WHEN json_extract(payload, '$.base') IS NULL THEN json('[]')
            ELSE json_array(json_extract(payload, '$.base')) END
        ),
        '$.base'
      )
      WHERE type = 'task.stack_based' AND json_type(payload, '$.bases') IS NULL`;
  }),
};
