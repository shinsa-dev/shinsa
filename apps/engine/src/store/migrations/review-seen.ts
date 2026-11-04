import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const REVIEW_SEEN: LogMigration = {
  name: 'review-seen',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(payload, '$.seen', json('null'))
      WHERE type = 'review.reported' AND json_type(payload, '$.seen') IS NULL`;
  }),
};
