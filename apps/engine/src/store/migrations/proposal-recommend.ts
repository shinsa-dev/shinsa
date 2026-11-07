import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const PROPOSAL_RECOMMEND: LogMigration = {
  name: 'proposal-recommend',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(payload, '$.recommend', 'go_on')
      WHERE type = 'task.change_proposed' AND json_type(payload, '$.recommend') IS NULL`;
  }),
};
