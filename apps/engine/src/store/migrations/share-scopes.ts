import { SHARE_PRESET_SCOPES, SHARE_PRESETS } from '@shinsa/core';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const SHARE_SCOPES: LogMigration = {
  name: 'share-scopes',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const preset of SHARE_PRESETS) {
      yield* sql`UPDATE events
        SET payload = json_remove(json_set(payload, '$.scopes', json(${JSON.stringify(SHARE_PRESET_SCOPES[preset])})), '$.preset')
        WHERE type = 'task.shared' AND json_extract(payload, '$.preset') = ${preset}`;
    }
  }),
};
