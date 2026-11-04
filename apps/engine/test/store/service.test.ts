import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Effect, Layer, Option } from 'effect';
import { SqlClient } from 'effect/sql';
import { EngineConfig } from '../../src/config/service.ts';
import { CommandLog } from '../../src/store/commands/service.ts';
import { Events } from '../../src/store/events/service.ts';
import { Evidence } from '../../src/store/evidence/service.ts';
import { LogMigrator } from '../../src/store/migrations/service.ts';
import { Outbox } from '../../src/store/outbox/service.ts';
import { Receipts } from '../../src/store/receipts/service.ts';
import { runTest } from '../harness.ts';
import { createConfigAt } from '../helpers/config.ts';
import { createTempDir } from '../helpers/index.ts';

const TRIAGE = { kind: 'task.triage', taskId: 't1' } as const;

describe('the store services', () => {
  test('a command commits its events, effects and receipt in one go', async () => {
    const read = await runTest(
      Effect.gen(function* () {
        const log = yield* CommandLog;
        const committed = yield* log.commit({
          events: [{ type: 'project.removed', projectId: 'a' }],
          effects: [TRIAGE as never],
          cancellations: [],
          fromSeq: 0,
          at: 5,
          receipt: { id: 'client:1', type: 'project.remove', target: 'a', fingerprint: 'f' },
        });
        const events = yield* (yield* Events).read(0);
        const statuses = yield* (yield* Outbox).listStatuses;
        const receipt = yield* (yield* Receipts).select('client:1');
        return { committed, events, statuses, receipt };
      })
    );
    expect(read.committed.events).toEqual([{ type: 'project.removed', projectId: 'a', seq: 1, at: 5 }]);
    expect(read.events).toEqual({ events: read.committed.events, unreadable: [], lastSeq: 1 });
    expect(read.statuses.map(({ kind, status }) => [kind, status])).toEqual([['task.triage', 'pending']]);
    expect(Option.getOrThrow(read.receipt)).toMatchObject({
      status: 'accepted',
      firstSeq: 1,
      lastSeq: 1,
      at: 5,
    });
  });

  test('a row that breaks its schema is unreadable, never a crash', async () => {
    const read = await runTest(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO events (seq, at, type, payload) VALUES (1, 1, 'focus.changed', '{"type":"focus.ch')`;
        yield* sql`INSERT INTO events (seq, at, type, payload) VALUES (2, 1, 'focus.changed', '[1]')`;
        return yield* (yield* Events).read(0);
      })
    );
    expect(read.events).toEqual([]);
    expect(read.unreadable.map(({ seq }) => seq)).toEqual([1, 2]);
    expect(read.unreadable[0]?.error).toStartWith('The stored event is not valid JSON: ');
    expect(read.unreadable[1]?.error).toBe('The stored event does not match its type.');
  });

  test('a log older than the baseline fails with LogVersionError', async () => {
    const error = await runTest(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`PRAGMA user_version = 3`;
        return yield* Effect.flip((yield* LogMigrator).migrate([]));
      })
    );
    expect(error._tag).toBe('LogVersionError');
    expect(error.version).toBe(3);
  });

  test('evidence refusals are typed', async () => {
    const dir = createTempDir();
    const errors = await runTest(
      Effect.gen(function* () {
        const evidence = yield* Evidence;
        const folder = yield* Effect.flip(evidence.writeText('x', { taskId: '../x', round: 1 }, 'x', 'txt'));
        const missing = yield* Effect.flip(
          evidence.copyFile(join(dir, 'missing'), { taskId: 't', round: 1 }, 'x')
        );
        return [folder, missing];
      }).pipe(
        Effect.provide(
          Evidence.layer.pipe(
            Layer.provide(Layer.succeed(EngineConfig, createConfigAt(createTempDir(), { evidenceDir: dir })))
          )
        )
      )
    );
    expect(errors.map((error) => error._tag)).toEqual(['EvidenceFolderInvalid', 'EvidenceSourceMissing']);
  });
});
