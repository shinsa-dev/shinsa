import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateLegacyData } from '../../src/config/migrate.ts';
import { EventLog } from '../../src/store/index.ts';
import { commitEvents, createTempDir } from '../helpers/index.ts';

function createLegacy(events = 3) {
  const from = join(createTempDir(), '.shinsa');
  mkdirSync(join(from, 'evidence'), { recursive: true });
  mkdirSync(join(from, 'transcripts', 'nested'), { recursive: true });
  mkdirSync(join(from, 'worktrees', 'app'), { recursive: true });
  const log = new EventLog(join(from, 'shinsa.sqlite'));
  for (let seq = 0; seq < events; seq += 1) {
    commitEvents(
      log,
      [{ type: 'focus.changed', focus: { projectId: null, until: seq } }],
      [{ kind: 'briefing.request', projectId: null }],
      seq,
      seq + 1
    );
  }
  log.close();
  writeFileSync(join(from, 'evidence', 'shot.png'), 'png');
  writeFileSync(join(from, 'transcripts', 'run-1.jsonl'), '{"a":1}\n');
  writeFileSync(join(from, 'transcripts', 'nested', 'run-2.jsonl'), '{"b":2}\n');
  return from;
}

describe('migrateLegacyData', () => {
  test('copies the database, transcripts and evidence, verifies them and switches; the original stays', () => {
    const from = createLegacy();
    const to = join(createTempDir(), 'shinsa', 'data');
    const before = readdirSync(from).sort();
    expect(migrateLegacyData(from, to)).toEqual({ status: 'migrated', from, to, events: 3, files: 3 });
    const db = new Database(join(to, 'shinsa.sqlite'), { readonly: true });
    expect(db.query('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 3 });
    expect(db.query('SELECT COUNT(*) AS n FROM effects').get()).toEqual({ n: 3 });
    db.close();
    expect(readFileSync(join(to, 'transcripts', 'nested', 'run-2.jsonl'), 'utf8')).toBe('{"b":2}\n');
    expect(readFileSync(join(to, 'evidence', 'shot.png'), 'utf8')).toBe('png');
    expect(existsSync(join(to, 'worktrees'))).toBe(false);
    expect(readdirSync(from).sort()).toEqual(before);
    expect(readdirSync(join(to, '..')).filter((name) => name.includes('migrating'))).toEqual([]);
  });

  test('does nothing without an old database, with data already in place, or without a source', () => {
    const to = join(createTempDir(), 'data');
    expect(migrateLegacyData(null, to)).toEqual({ status: 'none' });
    expect(migrateLegacyData(to, to)).toEqual({ status: 'none' });
    expect(migrateLegacyData(createTempDir(), to)).toEqual({ status: 'none' });
    const from = createLegacy();
    mkdirSync(to, { recursive: true });
    new EventLog(join(to, 'shinsa.sqlite')).close();
    expect(migrateLegacyData(from, to)).toEqual({ status: 'none' });
  });

  test('takes over an empty data directory but never one that holds other files', () => {
    const from = createLegacy(1);
    const empty = join(createTempDir(), 'data');
    mkdirSync(empty);
    expect(migrateLegacyData(from, empty).status).toBe('migrated');
    const busy = join(createTempDir(), 'data');
    mkdirSync(busy);
    writeFileSync(join(busy, 'notes.txt'), '');
    expect(migrateLegacyData(from, busy)).toEqual({
      status: 'failed',
      from,
      to: busy,
      reason: `${busy} already holds other files; nothing was moved.`,
    });
  });

  test('a copy that cannot be read back is thrown away and nothing switches', () => {
    const from = createLegacy(1);
    chmodSync(join(from, 'transcripts', 'run-1.jsonl'), 0o000);
    const to = join(createTempDir(), 'data');
    const result = migrateLegacyData(from, to);
    chmodSync(join(from, 'transcripts', 'run-1.jsonl'), 0o644);
    expect(result.status).toBe('failed');
    expect(existsSync(to)).toBe(false);
    expect(readdirSync(join(to, '..'))).toEqual([]);
  });

  test('a copy that differs from the original is thrown away: fewer events, or a shorter file', () => {
    const from = createLegacy(2);
    const to = join(createTempDir(), 'data');
    const short = migrateLegacyData(from, to, {
      snapshot: (source, target) => {
        const db = new Database(source, { readonly: true });
        db.run('VACUUM INTO ?', [target]);
        db.close();
        const copy = new Database(target);
        copy.run('DELETE FROM events WHERE seq = 2');
        copy.close();
      },
      copyTree: () => undefined,
    });
    expect(short).toMatchObject({
      status: 'failed',
      reason: 'The database copy has 1 events, the original 2; nothing was switched.',
    });
    const truncated = migrateLegacyData(from, to, {
      snapshot: (source, target) => {
        const db = new Database(source, { readonly: true });
        db.run('VACUUM INTO ?', [target]);
        db.close();
      },
      copyTree: (_source, target) => {
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, 'shot.png'), 'p');
      },
    });
    expect(truncated).toMatchObject({
      status: 'failed',
      reason: 'transcripts/run-1.jsonl did not copy completely.',
    });
    expect(existsSync(to)).toBe(false);
  });

  test('a database that is not Shinsa’s fails the copy', () => {
    const from = join(createTempDir(), '.shinsa');
    mkdirSync(from);
    const db = new Database(join(from, 'shinsa.sqlite'), { create: true });
    db.run('CREATE TABLE other (x INTEGER)');
    db.close();
    const result = migrateLegacyData(from, join(createTempDir(), 'data'));
    expect(result).toMatchObject({ status: 'failed', reason: 'no such table: events' });
  });
});
