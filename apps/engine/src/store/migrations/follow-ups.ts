import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const FOLLOW_UPS: LogMigration = {
  name: 'follow-ups',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(
        payload,
        '$.decisions',
        (
          SELECT json_group_array(json_insert(decision.value, '$.followUp', json('null')))
          FROM (SELECT value FROM json_each(events.payload, '$.decisions') ORDER BY key) AS decision
        )
      )
      WHERE type = 'autopilot.decided'
        AND EXISTS (
          SELECT 1 FROM json_each(events.payload, '$.decisions') AS entry
          WHERE json_type(entry.value, '$.followUp') IS NULL
        )`;
    yield* sql`UPDATE events
      SET payload = json_insert(payload, '$.followUp', json('null'))
      WHERE type = 'autopilot.guessed' AND json_type(payload, '$.followUp') IS NULL`;
  }),
};
