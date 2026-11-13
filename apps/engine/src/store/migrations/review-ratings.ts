import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const REVIEW_RATINGS: LogMigration = {
  name: 'review-ratings',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(payload, '$.ratings', json('null'))
      WHERE type = 'review.reported' AND json_type(payload, '$.ratings') IS NULL`;
  }),
};
