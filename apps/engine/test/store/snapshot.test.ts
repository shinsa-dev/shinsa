import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createState, type ShinsaState } from '@shinsa/core';
import { resolveStateVersion } from '../../src/store/index.ts';
import { runFiles } from '../harness.ts';
import { openEventLog } from '../helpers/event-log.ts';
import { commitEvents, createTempDir, writeFiles } from '../helpers/index.ts';

function openLog() {
  const path = join(createTempDir(), 'shinsa.sqlite');
  return { path, log: openEventLog(path) };
}

function stateAt(seq: number): ShinsaState {
  return { ...createState(), seq };
}

function snapshotOf(state: ShinsaState, version = 'v1') {
  return { seq: state.seq, version, payload: JSON.stringify(state), problems: [] };
}

describe('state snapshots', () => {
  test('read back the state they were written with, and the events after them', () => {
    const { log } = openLog();
    commitEvents(
      log,
      [
        { type: 'project.removed', projectId: 'a' },
        { type: 'project.removed', projectId: 'b' },
      ],
      [],
      0,
      1000
    );
    expect(log.selectSnapshot('v1')).toBeNull();
    expect(log.writeSnapshot(snapshotOf(stateAt(1)), 2000)).toBe(true);
    expect(log.selectSnapshot('v1')).toEqual({ ok: true, seq: 1, state: stateAt(1), problems: [] });
    expect(log.readEvents(1)).toEqual({
      events: [{ type: 'project.removed', projectId: 'b', seq: 2, at: 1000 }],
      unreadable: [],
      lastSeq: 2,
    });
    expect(log.readEvents(2)).toEqual({ events: [], unreadable: [], lastSeq: 2 });
    expect(log.writeSnapshot(snapshotOf(stateAt(2)), 3000)).toBe(true);
    expect(log.selectSnapshot('v1')).toMatchObject({ ok: true, seq: 2 });
    log.close();
  });

  test('an empty log can be snapshotted at zero, a position without an event cannot', () => {
    const { log } = openLog();
    expect(log.writeSnapshot(snapshotOf(stateAt(0)), 1)).toBe(true);
    expect(log.selectSnapshot('v1')).toMatchObject({ ok: true, seq: 0 });
    expect(log.writeSnapshot(snapshotOf(stateAt(5)), 1)).toBe(false);
    expect(log.selectSnapshot('v1')).toMatchObject({ ok: true, seq: 0 });
    log.close();
  });

  test('are refused for another version, a log that changed under them, a damaged payload or one that does not read', () => {
    const { path, log } = openLog();
    commitEvents(log, [{ type: 'project.removed', projectId: 'a' }], [], 0, 1000);
    log.writeSnapshot(snapshotOf(stateAt(1)), 2000);
    expect(log.selectSnapshot('v2')).toEqual({ ok: false, seq: 1, reason: 'version' });
    const db = new Database(path);
    db.run('UPDATE events SET payload = \'{"type":"project.removed","projectId":"z"}\' WHERE seq = 1');
    expect(log.selectSnapshot('v1')).toEqual({ ok: false, seq: 1, reason: 'anchor' });
    db.run('UPDATE events SET payload = \'{"type":"project.removed","projectId":"a"}\' WHERE seq = 1');
    expect(log.selectSnapshot('v1')).toMatchObject({ ok: true });
    db.run('UPDATE snapshots SET payload = \'{"seq":1}\'');
    expect(log.selectSnapshot('v1')).toEqual({ ok: false, seq: 1, reason: 'checksum' });
    const unreadable: [string, string][] = [
      ['not json', '[]'],
      ['{"seq":2}', '[]'],
      ['{"seq":1}', '{}'],
      ['null', '[]'],
    ];
    for (const [payload, problems] of unreadable) {
      db.run('UPDATE snapshots SET payload = ?, problems = ?, checksum = ?', [
        payload,
        problems,
        Bun.hash(payload).toString(36),
      ]);
      expect(log.selectSnapshot('v1')).toEqual({ ok: false, seq: 1, reason: 'unreadable' });
    }
    db.close();
    log.close();
  });
});

describe('the state version', () => {
  test('follows the source of the code that folds events into state, and no other file', async () => {
    const root = createTempDir();
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(join(root, 'state', 'project.ts'), 'export const a = 1;');
    const version = (at?: string) => runFiles(resolveStateVersion(at));
    const first = await version(root);
    expect(first).toMatch(/^[0-9a-f]{24}$/);
    expect(await version(root)).toBe(first);
    writeFiles(root, { 'README.md': 'x', '.cache/skip.ts': 'x', 'state/.hidden.ts': 'x' });
    expect(await version(root)).toBe(first);
    writeFileSync(join(root, 'state', 'project.ts'), 'export const a = 2;');
    expect(await version(root)).not.toBe(first);
    expect(await version()).toMatch(/^[0-9a-f]{24}$/);
  });

  test('is null where the source cannot be read, so the engine replays the whole log', async () => {
    expect(await runFiles(resolveStateVersion(createTempDir()))).toBeNull();
    expect(await runFiles(resolveStateVersion(join(createTempDir(), 'missing')))).toBeNull();
  });
});
