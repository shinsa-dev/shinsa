import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const SLACK_CHANNEL_NAMES: LogMigration = {
  name: 'slack-channel-names',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE events
      SET payload = json_set(payload, '$.link.channelName', json('null'))
      WHERE type = 'slack.thread_linked' AND json_type(payload, '$.link.channelName') IS NULL`;
  }),
};
