import { Database } from 'bun:sqlite';
import { describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { applyStatePatch, resolveStatePatch, type ShinsaState } from '@shinsa/core';
import { log as logger } from '../../src/log/index.ts';
import { Engine } from '../../src/runtime/engine.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir, until } from '../helpers/index.ts';

const VERSION = 'test-version';

function openEngine(
  path: string,
  options: ConstructorParameters<typeof Engine>[1] = { stateVersion: VERSION }
) {
  const log = new EventLog(path);
  return { log, engine: new Engine(log, options) };
}

function countSnapshots(path: string) {
  const db = new Database(path);
  const row = db.query<{ seq: number | null }, []>('SELECT MAX(seq) AS seq FROM snapshots').get();
  db.close();
  return row?.seq ?? null;
}

function focus(engine: Engine, value: number) {
  return engine.dispatch({ type: 'focus.change', projectId: null, until: value });
}

describe('booting from a snapshot', () => {
  test('a stop writes the state, and the next boot replays only what came after it', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const first = openEngine(path);
    first.engine.start();
    for (const value of [1, 2, 3]) await focus(first.engine, value);
    first.engine.stop();
    first.log.close();
    expect(countSnapshots(path)).toBe(3);
    const db = new Database(path);
    db.run('UPDATE events SET payload = \'{"type":"focus.ch\' WHERE seq = 2');
    db.close();
    const second = openEngine(path);
    expect(second.engine.state.focus.until).toBe(3);
    expect(second.engine.problems).toEqual([]);
    await focus(second.engine, 4);
    second.engine.stop();
    second.log.close();
    const third = openEngine(path);
    expect(third.engine.state.focus.until).toBe(4);
    third.log.close();
  });

  test('a snapshot of another version, or of a log that changed, is replaced by a replay of the whole log', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const first = openEngine(path);
    for (const value of [1, 2]) await focus(first.engine, value);
    expect(first.engine.writeSnapshot()).toBe(true);
    expect(first.engine.writeSnapshot()).toBe(false);
    first.log.close();
    const other = openEngine(path, { stateVersion: 'another' });
    expect(other.engine.state.focus.until).toBe(2);
    other.log.close();
    const db = new Database(path);
    db.run(
      `UPDATE events SET payload = '{"type":"focus.changed","focus":{"projectId":null,"until":9}}' WHERE seq = 2`
    );
    db.close();
    const changed = openEngine(path);
    expect(changed.engine.state.focus.until).toBe(9);
    changed.log.close();
  });

  test('problems found before the snapshot are still reported after booting from it', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const first = openEngine(path);
    for (const value of [1, 2, 3]) await focus(first.engine, value);
    first.log.close();
    const db = new Database(path);
    db.run('UPDATE events SET payload = \'{"type":"focus.ch\' WHERE seq = 1');
    db.close();
    const damaged = openEngine(path);
    expect(damaged.engine.writeSnapshot()).toBe(true);
    damaged.log.close();
    const booted = openEngine(path);
    expect(booted.engine.problems.map((problem) => [problem.seq, problem.kind])).toEqual([[1, 'unreadable']]);
    booted.log.close();
  });

  test('without a version, or read-only, nothing is written', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const plain = openEngine(path, {});
    plain.engine.start();
    await focus(plain.engine, 1);
    expect(plain.engine.writeSnapshot()).toBe(false);
    plain.engine.stop();
    plain.log.close();
    const inspect = openEngine(path, { stateVersion: VERSION, readOnly: true });
    inspect.engine.start();
    expect(inspect.engine.writeSnapshot()).toBe(false);
    inspect.engine.stop();
    inspect.log.close();
    expect(countSnapshots(path)).toBeNull();
  });

  test('a boot with events past the snapshot writes a new one once things are quiet', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const first = openEngine(path, {});
    await focus(first.engine, 1);
    first.log.close();
    const second = openEngine(path, { stateVersion: VERSION, snapshotQuietMs: 20 });
    second.engine.start();
    await until('the quiet snapshot', () => countSnapshots(path) === 1);
    second.engine.stop();
    second.log.close();
  });

  test('a run of commands writes a snapshot once it reaches the threshold and goes quiet, and not before', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const { engine, log } = openEngine(path, {
      stateVersion: VERSION,
      snapshotEvery: 3,
      snapshotQuietMs: 20,
    });
    engine.start();
    for (const value of [1, 2]) await focus(engine, value);
    await Bun.sleep(60);
    expect(countSnapshots(path)).toBeNull();
    for (const value of [3, 4]) await focus(engine, value);
    await until('the snapshot after the burst', () => countSnapshots(path) === 4);
    engine.stop();
    log.close();
  });
});

describe('state changes', () => {
  test('each listener hears the state before and what changed, which patches the old state into the new', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const { engine, log } = openEngine(path, {});
    let client = JSON.parse(JSON.stringify(engine.state)) as ShinsaState;
    const kept = engine.state;
    engine.subscribe((state, change) => {
      const patch = JSON.parse(JSON.stringify(resolveStatePatch(change.previous, state, change.changes)));
      client = applyStatePatch(client, patch) ?? client;
    });
    await engine.dispatch({ type: 'project.write', project: { name: 'Superwall', color: 'blue' } });
    await engine.dispatch({ type: 'task.create', request: 'Fix the tab scroll', repoId: null });
    await engine.dispatch({ type: 'focus.change', projectId: null, until: 7 });
    expect(client).toEqual(JSON.parse(JSON.stringify(engine.state)));
    expect(kept.seq).toBe(0);
    expect(Object.keys(kept.tasks)).toEqual([]);
    log.close();
  });
});

describe('a snapshot that cannot be written', () => {
  test('is logged and left for the next one, never thrown', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const { log, engine } = openEngine(path);
    await focus(engine, 1);
    log.close();
    const warned = spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      expect(engine.writeSnapshot()).toBe(false);
      expect(warned.mock.calls[0]?.[0]).toBe('[Engine] Could not write the state snapshot');
    } finally {
      warned.mockRestore();
    }
  });
});

describe('the Home guide', () => {
  const guide = { now: null, next: [], running: 'No agent is working right now.', note: null };

  test('is kept beside the log, changes the state without an event and comes back on the next boot', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const first = openEngine(path);
    await focus(first.engine, 1);
    expect(first.engine.writeSnapshot()).toBe(true);
    const seen: { seq: number; changes: unknown; before: unknown }[] = [];
    first.engine.subscribe((state, { previous, changes }) => {
      seen.push({ seq: state.seq, changes, before: previous.briefings['*'] });
    });
    await first.engine.writeBriefing(null, { text: 'Nothing needs you.', briefing: guide });
    await first.engine.writeBriefing('work', { text: 'Plain.', briefing: guide });
    expect(seen).toEqual([
      { seq: 1, changes: { briefings: ['*'] }, before: undefined },
      {
        seq: 1,
        changes: { briefings: ['work'] },
        before: expect.objectContaining({ text: 'Nothing needs you.' }),
      },
    ]);
    expect(first.engine.state.briefings['*']).toMatchObject({ text: 'Nothing needs you.', briefing: guide });
    expect(first.log.readEvents().events.map((event) => event.type)).toEqual(['focus.changed']);
    first.log.close();
    const second = openEngine(path);
    expect(second.engine.state.seq).toBe(1);
    expect(Object.keys(second.engine.state.briefings)).toEqual(['*', 'work']);
    expect(second.engine.state.briefings.work).toMatchObject({ text: 'Plain.', briefing: guide });
    second.log.close();
  });

  test('is refused in inspect mode and once the engine stops', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const inspect = openEngine(path, { readOnly: true });
    await expect(inspect.engine.writeBriefing(null, { text: 'No.', briefing: guide })).rejects.toMatchObject({
      code: 'inspect_read_only',
    });
    inspect.log.close();
    const stopped = openEngine(path);
    stopped.engine.stop();
    await expect(stopped.engine.writeBriefing(null, { text: 'No.', briefing: guide })).rejects.toThrow(
      'Shinsa is shutting down.'
    );
    stopped.log.close();
  });

  test('one that cannot be stored is refused, and the engine goes on with its next command', async () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const { log, engine } = openEngine(path);
    const write = spyOn(log, 'writeBriefing').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(engine.writeBriefing(null, { text: 'Lost.', briefing: guide })).rejects.toThrow('disk full');
    expect(engine.state.briefings['*']).toBeUndefined();
    await focus(engine, 2);
    expect(engine.state.focus.until).toBe(2);
    write.mockRestore();
    log.close();
  });

  test('a stored guide that cannot be read is left out', () => {
    const path = join(createTempDir(), 'shinsa.sqlite');
    const log = new EventLog(path);
    log.writeBriefing(null, { text: 'Kept.', at: 5, briefing: null });
    const db = new Database(path);
    db.run(
      "INSERT INTO briefings (project, at, payload) VALUES ('a', 1, 'not json'), ('b', 1, '{\"at\":1}')"
    );
    db.run(
      `INSERT INTO briefings (project, at, payload) VALUES ('c', 1, '{"projectId":"c","text":"T","at":2,"briefing":{"now":null,"next":[],"running":"","note":null}}')`
    );
    db.close();
    expect(log.listBriefings()).toEqual([
      { projectId: null, stored: { text: 'Kept.', at: 5, briefing: null } },
      {
        projectId: 'c',
        stored: { text: 'T', at: 2, briefing: { now: null, next: [], running: '', note: null } },
      },
    ]);
    log.close();
  });
});
