import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const RESET_PACES: LogMigration = {
  name: 'reset-paces',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(
        payload,
        '$.resetPace', coalesce(json_extract(payload, '$.resetPace'), json_extract(payload, '$.pace')),
        '$.endingPace', json_extract(payload, '$.pace'),
        '$.resetEndsAt', json_extract(payload, '$.resetEndsAt')
      )
      WHERE type = 'usage.pace_recorded' AND json_type(payload, '$.endingPace') IS NULL`;
  }),
};
