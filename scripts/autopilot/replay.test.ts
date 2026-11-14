import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import { Effect, Exit, FileSystem, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { Events } from '../../apps/engine/src/store/events/service.ts';
import { StoreLayer } from '../../apps/engine/src/store/layers.ts';
import { LOG_BASELINE } from '../../apps/engine/src/store/migrations/schema.ts';
import type { AutopilotDecision, AutopilotDecisionAnswer } from '../../packages/core/src/index.ts';
import { createTempDirectory } from '../kit/temp.ts';
import { replayAutopilotLog } from './replay.ts';

const VersionRow = Schema.Struct({ user_version: Schema.Int });

function decision(answer: AutopilotDecisionAnswer, at: number): AutopilotDecision {
  return {
    at,
    taskId: `task-${at}`,
    gateId: `gate-${at}`,
    kind: 'review',
    answer,
    projectId: 'project',
    risk: 'low',
    scope: { phases: 2, files: 3 },
    urgent: false,
    watchdog: false,
    touched: false,
    guess: at % 2 === 0 ? 'act' : null,
    note: null,
    facts: null,
    estimate: null,
  };
}

const writeLog = Effect.fn('writeLog')(function* (dataDir: string) {
  const events = yield* Events;
  yield* events.append({
    events: [
      {
        type: 'autopilot.decided',
        decisions: [
          decision('approved', 1),
          decision('approved', 2),
          decision('revised', 3),
          decision('approved', 4),
        ],
      },
    ],
    fromSeq: 0,
    at: 1,
  });
  return dataDir;
});

const writeVersion = Effect.fn('writeVersion')(function* (version: number) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`PRAGMA user_version = ${sql.literal(String(version))}`;
});

const readVersion = Effect.fn('readVersion')(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`PRAGMA user_version`;
  return Schema.decodeUnknownSync(VersionRow)(rows[0]).user_version;
});

function run<A, E>(effect: Effect.Effect<A, E, never>) {
  return Effect.runPromiseExit(effect);
}

function withLog<A, E, R>(use: (dataDir: string, database: string) => Effect.Effect<A, E, R>) {
  return Effect.scoped(
    Effect.gen(function* () {
      const dataDir = yield* createTempDirectory('shinsa-benchmark-test-');
      const database = join(dataDir, 'shinsa.sqlite');
      yield* writeLog(dataDir).pipe(Effect.provide(StoreLayer(database)));
      return yield* use(dataDir, database);
    })
  ).pipe(Effect.provide(BunServices.layer));
}

describe('replaying a copy of the event log', () => {
  test('folds every decision through the current model and benchmarks it', async () => {
    const exit = await run(withLog((dataDir) => replayAutopilotLog(dataDir)));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const { events, unreadable, benchmark, source } = exit.value;
    expect(source).toEndWith('shinsa.sqlite');
    expect(events).toBe(1);
    expect(unreadable).toBe(0);
    expect(benchmark.decisions).toBe(4);
    expect(benchmark.judged).toBe(4);
    const call = benchmark.rows.find(
      (row) => row.kind === 'review' && row.scope === 'all' && row.track === 'call'
    );
    expect(call).toMatchObject({ scored: 2, agreed: 2 });
  });

  test('gives the same numbers every time it replays the same log', async () => {
    const exit = await run(
      withLog((dataDir) =>
        Effect.all([replayAutopilotLog(dataDir), replayAutopilotLog(dataDir)]).pipe(Effect.scoped)
      )
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value[0].benchmark).toEqual(exit.value[1].benchmark);
  });

  test('migrates the copy and leaves your own log at its version', async () => {
    const exit = await run(
      withLog((dataDir, database) =>
        Effect.gen(function* () {
          yield* writeVersion(LOG_BASELINE).pipe(Effect.provide(SqliteClient.layer({ filename: database })));
          const replay = yield* replayAutopilotLog(dataDir).pipe(Effect.scoped);
          const version = yield* readVersion().pipe(
            Effect.provide(SqliteClient.layer({ filename: database }))
          );
          return { replay, version };
        })
      )
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value.version).toBe(LOG_BASELINE);
    expect(exit.value.replay.benchmark.judged).toBe(4);
  });

  test('says why when the log is too old to read', async () => {
    const exit = await run(
      withLog((dataDir, database) =>
        writeVersion(1).pipe(
          Effect.provide(SqliteClient.layer({ filename: database })),
          Effect.andThen(replayAutopilotLog(dataDir).pipe(Effect.scoped))
        )
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain('older than any this one reads');
  });

  test('says where it looked when there is no log', async () => {
    const exit = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const dataDir = yield* createTempDirectory('shinsa-benchmark-empty-');
          return yield* replayAutopilotLog(dataDir);
        })
      ).pipe(Effect.provide(BunServices.layer))
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain('There is no event log at');
  });

  test('says so when the log cannot be copied', async () => {
    const exit = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const dataDir = yield* createTempDirectory('shinsa-benchmark-broken-');
          yield* fs.writeFileString(join(dataDir, 'shinsa.sqlite'), 'not a database').pipe(Effect.orDie);
          return yield* replayAutopilotLog(dataDir);
        })
      ).pipe(Effect.provide(BunServices.layer))
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain('Could not copy');
  });
});
