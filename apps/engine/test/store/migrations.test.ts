import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { Engine } from '../../src/runtime/engine.ts';
import { EventLog } from '../../src/store/index.ts';
import { LOG_MIGRATIONS, resolveLogVersion } from '../../src/store/migrations/list.ts';
import { LOG_BASELINE, type LogMigration, LogVersionError } from '../../src/store/migrations/schema.ts';
import { commitEvents, createTempDir } from '../helpers/index.ts';

function createLogPath() {
  return join(createTempDir(), 'shinsa.sqlite');
}

function readVersion(path: string) {
  const db = new Database(path);
  const version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
  db.close();
  return version;
}

function writeLog(path: string, version: number) {
  const log = new EventLog(path);
  commitEvents(log, [{ type: 'project.removed', projectId: 'a' }], [], 0, 1);
  log.close();
  const db = new Database(path);
  db.run(`PRAGMA user_version = ${version}`);
  db.close();
}

function renameProject(name: string, to: string): LogMigration {
  return {
    name,
    migrate: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE events SET payload = ${JSON.stringify({ type: 'project.removed', projectId: to })} WHERE seq = 1`;
    }),
  };
}

const TWO_MIGRATIONS = [renameProject('rename-b', 'b'), renameProject('rename-c', 'c')];

describe('event log migrations', () => {
  test('the shipped list turns stacks into lists, one version past the baseline', () => {
    expect(LOG_MIGRATIONS.map((migration) => migration.name)).toEqual(['stack-lists']);
    expect(resolveLogVersion()).toBe(LOG_BASELINE + 1);
    expect(resolveLogVersion(TWO_MIGRATIONS)).toBe(LOG_BASELINE + 2);
  });

  test('a new log is stamped with the current version and needs nothing', () => {
    const path = createLogPath();
    const log = new EventLog(path);
    expect(log.migrate()).toEqual([]);
    expect(() => log.assertCurrent()).not.toThrow();
    log.close();
    expect(readVersion(path)).toBe(LOG_BASELINE + 1);
  });

  test('a log that already holds events is never stamped on open', () => {
    const path = createLogPath();
    writeLog(path, 0);
    new EventLog(path).close();
    expect(readVersion(path)).toBe(0);
  });

  test.each([0, 7, LOG_BASELINE - 1])('a log at version %i is refused, never rewritten', (version) => {
    const path = createLogPath();
    writeLog(path, version);
    const log = new EventLog(path);
    const refusal = new LogVersionError({
      message: `This event log is at version ${version}, from a Shinsa older than any this one reads (${LOG_BASELINE} and later). Move the data folder aside and start Shinsa again to begin a new log.`,
      version,
    });
    expect(() => log.migrate()).toThrow(refusal);
    expect(() => log.assertCurrent()).toThrow(refusal);
    expect(() => new Engine(log)).toThrow(LogVersionError);
    expect(() => new Engine(log, { readOnly: true })).toThrow(LogVersionError);
    expect(log.readEvents().events).toEqual([{ type: 'project.removed', projectId: 'a', seq: 1, at: 1 }]);
    log.close();
    expect(readVersion(path)).toBe(version);
  });

  test('pending migrations run in order once, drop the snapshot and raise the version', () => {
    const path = createLogPath();
    writeLog(path, LOG_BASELINE);
    const log = new EventLog(path);
    log.writeSnapshot({ seq: 1, version: 'v', payload: '{}', problems: [] }, 1);
    expect(log.migrate(TWO_MIGRATIONS)).toEqual(['rename-b', 'rename-c']);
    expect(log.readEvents().events).toEqual([{ type: 'project.removed', projectId: 'c', seq: 1, at: 1 }]);
    expect(log.selectSnapshot('v')).toBeNull();
    expect(log.migrate(TWO_MIGRATIONS)).toEqual([]);
    log.close();
    expect(readVersion(path)).toBe(LOG_BASELINE + 2);
  });

  test('a log part of the way there runs only the migrations after its version', () => {
    const path = createLogPath();
    writeLog(path, LOG_BASELINE + 1);
    const log = new EventLog(path);
    expect(log.migrate(TWO_MIGRATIONS)).toEqual(['rename-c']);
    log.close();
  });

  test('a migration that fails leaves the log as it was', () => {
    const path = createLogPath();
    writeLog(path, LOG_BASELINE);
    const log = new EventLog(path);
    const failing: LogMigration = {
      name: 'broken',
      migrate: Effect.die(new Error('broken')),
    };
    expect(() => log.migrate([TWO_MIGRATIONS[0] as LogMigration, failing])).toThrow('broken');
    expect(log.readEvents().events[0]).toMatchObject({ projectId: 'a' });
    log.close();
    expect(readVersion(path)).toBe(LOG_BASELINE);
  });

  test('inspect mode refuses a log that still needs migrating', () => {
    const path = createLogPath();
    writeLog(path, LOG_BASELINE);
    const log = new EventLog(path);
    expect(() => log.assertCurrent(TWO_MIGRATIONS)).toThrow(
      new LogVersionError({
        message: `This event log is at version ${LOG_BASELINE} and needs migrating to version ${LOG_BASELINE + 2}. Open it once with a Shinsa that can write to it, then inspect it again.`,
        version: LOG_BASELINE,
      })
    );
    log.close();
    expect(readVersion(path)).toBe(LOG_BASELINE);
  });

  test('stack-lists turns one task stacked on and one base into lists, and leaves lists as they are', () => {
    const path = createLogPath();
    writeLog(path, LOG_BASELINE);
    const db = new Database(path);
    const rows = [
      { type: 'task.stack_changed', taskId: 't1', stacksOn: 'p1', by: 'you' },
      { type: 'task.stack_changed', taskId: 't1', stacksOn: null },
      { type: 'task.stack_changed', taskId: 't2', stacksOn: ['p1', 'p2'] },
      { type: 'task.stack_based', taskId: 't1', base: 'fix/p1' },
      { type: 'task.stack_based', taskId: 't1', base: null },
      { type: 'task.stack_based', taskId: 't2', bases: ['fix/p1', 'fix/p2'] },
    ];
    for (const [index, row] of rows.entries()) {
      db.run('INSERT INTO events (seq, at, type, payload) VALUES (?, ?, ?, ?)', [
        index + 2,
        1,
        row.type,
        JSON.stringify(row),
      ]);
    }
    db.close();
    const log = new EventLog(path);
    expect(log.migrate()).toEqual(['stack-lists']);
    expect(log.readEvents().events.slice(1)).toEqual([
      { type: 'task.stack_changed', taskId: 't1', stacksOn: ['p1'], by: 'you', seq: 2, at: 1 },
      { type: 'task.stack_changed', taskId: 't1', stacksOn: [], seq: 3, at: 1 },
      { type: 'task.stack_changed', taskId: 't2', stacksOn: ['p1', 'p2'], seq: 4, at: 1 },
      { type: 'task.stack_based', taskId: 't1', bases: ['fix/p1'], seq: 5, at: 1 },
      { type: 'task.stack_based', taskId: 't1', bases: [], seq: 6, at: 1 },
      { type: 'task.stack_based', taskId: 't2', bases: ['fix/p1', 'fix/p2'], seq: 7, at: 1 },
    ]);
    log.close();
    expect(readVersion(path)).toBe(LOG_BASELINE + 1);
  });

  test('a log a newer Shinsa wrote opens as it is', () => {
    const path = createLogPath();
    writeLog(path, LOG_BASELINE + 5);
    const log = new EventLog(path);
    expect(log.migrate()).toEqual([]);
    expect(() => log.assertCurrent()).not.toThrow();
    expect(new Engine(log, { readOnly: true }).state.seq).toBe(1);
    log.close();
    expect(readVersion(path)).toBe(LOG_BASELINE + 5);
  });
});
