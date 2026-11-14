import { join } from 'node:path';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { Effect, FileSystem } from 'effect';
import { SqlClient } from 'effect/sql';
import { DATABASE_FILE } from '../../apps/engine/src/config/schema.ts';
import { Events } from '../../apps/engine/src/store/events/service.ts';
import { StoreLayer } from '../../apps/engine/src/store/layers.ts';
import { LOG_MIGRATIONS } from '../../apps/engine/src/store/migrations/list.ts';
import { LogMigrator } from '../../apps/engine/src/store/migrations/service.ts';
import { applyEvent, createState, resolveAutopilotBenchmark } from '../../packages/core/src/index.ts';
import { createTempDirectory } from '../kit/temp.ts';
import { BenchmarkFailed, type BenchmarkReplay } from './schema.ts';

const copyLog = Effect.fn('copyLog')(function* (copy: string) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`VACUUM INTO ${copy}`;
});

const readCopy = Effect.fn('readCopy')(function* () {
  const migrator = yield* LogMigrator;
  yield* migrator.migrate(LOG_MIGRATIONS);
  const events = yield* Events;
  return yield* events.read(0);
});

export const replayAutopilotLog = Effect.fn('replayAutopilotLog')(function* (dataDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const source = join(dataDir, DATABASE_FILE);
  const found = yield* fs.exists(source).pipe(Effect.orDie);
  if (!found)
    return yield* new BenchmarkFailed({
      message: `There is no event log at ${source}. Pass the data folder of a Shinsa, such as ~/.config/shinsa/data.`,
    });
  const scratch = yield* createTempDirectory('shinsa-benchmark-');
  const copy = join(scratch, DATABASE_FILE);
  yield* copyLog(copy).pipe(
    Effect.provide(SqliteClient.layer({ filename: source, readonly: true })),
    Effect.mapError((error) => new BenchmarkFailed({ message: `Could not copy ${source}: ${error.message}` }))
  );
  const read = yield* readCopy().pipe(
    Effect.provide(StoreLayer(copy)),
    Effect.mapError((error) => new BenchmarkFailed({ message: error.message }))
  );
  const state = read.events.reduce(applyEvent, createState());
  const replay: BenchmarkReplay = {
    source,
    events: read.events.length,
    unreadable: read.unreadable.length,
    benchmark: resolveAutopilotBenchmark(state.autopilotHistory ?? []),
  };
  return replay;
});
