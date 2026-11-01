import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../src/log/index.ts';
import {
  isHeldListExpired,
  readTeamSnapshotsFile,
  resolveKeyDigest,
  TEAM_SNAPSHOT_TTL_MS,
  TeamSnapshots,
} from '../../src/remote/team-snapshots.ts';
import { createTempDir } from '../helpers/index.ts';

const HELD = {
  teamId: 'team1',
  instanceId: 'inst1',
  keyDigest: resolveKeyDigest('key'),
  tasks: [],
  updatedAt: 5,
  snapshot: { body: '{}', signature: 'sig' },
};

describe('the kept team snapshots', () => {
  test('writes each list, reads it back, and removes the file with the last one', () => {
    const path = join(createTempDir(), 'team-snapshots.json');
    const store = new TeamSnapshots(path);
    store.write(HELD);
    store.write({ ...HELD, instanceId: 'inst2', snapshot: null });
    expect(new TeamSnapshots(path).list()).toEqual([HELD, { ...HELD, instanceId: 'inst2', snapshot: null }]);
    expect(store.select('team1', 'inst1')).toEqual(HELD);
    expect(store.select('team1', 'inst9')).toBeNull();
    store.remove('team1', 'inst9');
    store.remove('team1', 'inst1');
    expect(JSON.parse(readFileSync(path, 'utf8')).lists).toHaveLength(1);
    store.remove('team1', 'inst2');
    expect(existsSync(path)).toBe(false);
  });

  test('reads leniently: a missing file, bad JSON and entries out of shape give nothing', () => {
    const dir = createTempDir();
    const warn = spyOn(log, 'warn');
    expect(readTeamSnapshotsFile(join(dir, 'none.json'))).toEqual([]);
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{');
    expect(readTeamSnapshotsFile(broken)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const odd = join(dir, 'odd.json');
    writeFileSync(
      odd,
      JSON.stringify({
        lists: [null, { ...HELD, teamId: 3 }, { ...HELD, tasks: 'none' }, { ...HELD, snapshot: { body: 1 } }],
      })
    );
    expect(readTeamSnapshotsFile(odd)).toEqual([{ ...HELD, snapshot: null }]);
    writeFileSync(odd, JSON.stringify({ lists: 'none' }));
    expect(readTeamSnapshotsFile(odd)).toEqual([]);
  });

  test('logs a list it could not keep', () => {
    const dir = createTempDir();
    const path = join(dir, 'taken');
    mkdirSync(join(path, 'inside'), { recursive: true });
    const warn = spyOn(log, 'warn');
    new TeamSnapshots(path).write(HELD);
    expect(warn).toHaveBeenCalledWith('[Teams] Could not keep the team snapshots', expect.anything());
    warn.mockRestore();
  });

  test('a list expires 30 days after it was last updated', () => {
    expect(isHeldListExpired({ updatedAt: 0 }, TEAM_SNAPSHOT_TTL_MS)).toBe(false);
    expect(isHeldListExpired({ updatedAt: 0 }, TEAM_SNAPSHOT_TTL_MS + 1)).toBe(true);
    expect(resolveKeyDigest('a')).not.toBe(resolveKeyDigest('b'));
  });
});
