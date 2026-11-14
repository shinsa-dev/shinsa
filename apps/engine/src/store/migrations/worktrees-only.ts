import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LogMigration } from './schema.ts';

export const WORKTREES_ONLY: LogMigration = {
  name: 'worktrees-only',
  migrate: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM events WHERE type = 'worktree.requested'`;
    yield* sql`UPDATE events
      SET payload = json_remove(payload, '$.workspace', '$.returnBranch')
      WHERE type = 'worktree.created'
        AND (json_type(payload, '$.workspace') IS NOT NULL OR json_type(payload, '$.returnBranch') IS NOT NULL)`;
    yield* sql`UPDATE events
      SET payload = json_remove(payload, '$.repo.workspace')
      WHERE type IN ('repo.registered', 'repo.updated') AND json_type(payload, '$.repo.workspace') IS NOT NULL`;
  }),
};
