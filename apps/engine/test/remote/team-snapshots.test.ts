import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveKeyDigest } from '../../src/remote/team-snapshots/digest.ts';
import { createTempDir } from '../helpers/index.ts';
import { captureLogs } from '../helpers/logs.ts';
import { openTeamSnapshots, readTeamSnapshotsFile } from './kept.ts';

const HELD = {
  teamId: 'team1',
  instanceId: 'inst1',
  keyDigest: resolveKeyDigest('key'),
  tasks: [],
  updatedAt: 5,
  snapshot: { body: '{}', signature: 'sig' },
};

describe('the kept team snapshots', () => {
  test('writes each list, reads it back, and removes the file with the last one', async () => {
    const path = join(createTempDir(), 'team-snapshots.json');
    const store = await openTeamSnapshots(path);
    await store.write(HELD);
    await store.write({ ...HELD, instanceId: 'inst2', snapshot: null });
    expect(await (await openTeamSnapshots(path)).list()).toEqual([
      HELD,
      { ...HELD, instanceId: 'inst2', snapshot: null },
    ]);
    expect(await store.select('team1', 'inst1')).toEqual(HELD);
    expect(await store.select('team1', 'inst9')).toBeNull();
    await store.remove('team1', 'inst9');
    await store.remove('team1', 'inst1');
    expect(JSON.parse(readFileSync(path, 'utf8')).lists).toHaveLength(1);
    await store.remove('team1', 'inst2');
    expect(existsSync(path)).toBe(false);
  });

  test('reads leniently: a missing file, bad JSON and entries out of shape give nothing', async () => {
    const dir = createTempDir();
    const logs = captureLogs();
    expect(await readTeamSnapshotsFile(join(dir, 'none.json'))).toEqual([]);
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{');
    expect(await readTeamSnapshotsFile(broken)).toEqual([]);
    logs.restore();
    expect(logs.fieldsOf('[Teams] Could not read the kept team snapshots')).toEqual([
      { path: broken, error: expect.any(String) },
    ]);
    const odd = join(dir, 'odd.json');
    writeFileSync(
      odd,
      JSON.stringify({
        lists: [null, { ...HELD, teamId: 3 }, { ...HELD, tasks: 'none' }, { ...HELD, snapshot: { body: 1 } }],
      })
    );
    expect(await readTeamSnapshotsFile(odd)).toEqual([{ ...HELD, snapshot: null }]);
    writeFileSync(odd, JSON.stringify({ lists: 'none' }));
    expect(await readTeamSnapshotsFile(odd)).toEqual([]);
    writeFileSync(odd, 'null');
    expect(await readTeamSnapshotsFile(odd)).toEqual([]);
  });

  test('logs a list it could not keep', async () => {
    const dir = createTempDir();
    const path = join(dir, 'taken');
    mkdirSync(join(path, 'inside'), { recursive: true });
    const logs = captureLogs();
    const store = await openTeamSnapshots(path);
    await store.write(HELD);
    await store.remove('team1', 'inst1');
    logs.restore();
    expect(logs.fieldsOf('[Teams] Could not keep the team snapshots')).toEqual([
      { path, error: expect.any(String) },
      { path, error: expect.any(String) },
    ]);
  });

  test('keeps a digest of the team key, never the key', () => {
    expect(resolveKeyDigest('a')).not.toBe(resolveKeyDigest('b'));
  });
});
