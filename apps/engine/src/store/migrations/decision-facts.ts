import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const DECISION_FACTS: LogMigration = {
  name: 'decision-facts',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(
        payload,
        '$.decisions',
        (
          SELECT json_group_array(
            CASE WHEN json_type(decision.value, '$.facts') IS NULL
              THEN json_set(decision.value, '$.facts', json('null'))
              ELSE json(decision.value) END
          )
          FROM (SELECT value FROM json_each(events.payload, '$.decisions') ORDER BY key) AS decision
        )
      )
      WHERE type = 'autopilot.decided'
        AND EXISTS (
          SELECT 1 FROM json_each(events.payload, '$.decisions') AS entry
          WHERE json_type(entry.value, '$.facts') IS NULL
        )`;
  }),
};
