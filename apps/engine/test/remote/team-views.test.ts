import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShareMessage } from '@shinsa/core';
import { createTeamViewRecorder, type TeamViewRecorder } from '../../src/remote/team-views/recorder.ts';
import { TEAM_VIEWS_LIMIT } from '../../src/remote/team-views/schema.ts';
import { createTempDir } from '../helpers/index.ts';
import { captureLogs } from '../helpers/logs.ts';
import { openTeamViews } from './kept.ts';

function view(updatedAt: number, files: Record<string, string> = {}): ShareMessage {
  const listed = Object.fromEntries(
    Object.entries(files).map(([id, version]) => [id, { version, type: 'text/plain' }])
  );
  return { t: 'view', data: JSON.stringify({ shared: { task: { updatedAt } }, files: listed, updatedAt }) };
}

function file(id: string, version: string, chunks: string[]): ShareMessage[] {
  return [
    { t: 'file', id, version, type: 'text/plain' },
    ...chunks.map((chunk): ShareMessage => ({ t: 'body', id, chunk })),
    { t: 'end', id },
  ];
}

function record(recorder: TeamViewRecorder, messages: ShareMessage[]) {
  return messages.map((message) => recorder.receive(message));
}

const ENTRY = { teamId: 'team1', instanceId: 'inst1', taskId: 'task1', keyDigest: 'digest', updatedAt: 5 };

const SIZE = Buffer.byteLength(JSON.stringify([view(5)]));

describe('recording a teammate’s task view', () => {
  test('keeps the latest view and each file it lists, complete once every listed file came', () => {
    const recorder = createTeamViewRecorder();
    expect(recorder.messages()).toEqual([]);
    expect(recorder.isComplete).toBe(false);
    expect(record(recorder, [view(3, { diff: 'v1' })])).toEqual([true]);
    expect(recorder.updatedAt).toBe(3);
    expect(recorder.isComplete).toBe(false);
    expect(record(recorder, file('diff', 'v1', ['AA', 'BB']))).toEqual([false, false, false, true]);
    expect(recorder.isComplete).toBe(true);
    expect(recorder.messages().map((message) => message.t)).toEqual(['view', 'file', 'body', 'body', 'end']);
    record(recorder, [view(4, { diff: 'v2' })]);
    expect(recorder.messages().map((message) => message.t)).toEqual(['view']);
    record(recorder, [view(5, { diff: 'v2' }), ...file('diff', 'v2', ['CC'])]);
    record(recorder, [view(6, { diff: 'v2' })]);
    expect(recorder.messages()).toHaveLength(4);
  });

  test('leaves out a file past the size limit, and ignores what it cannot read', () => {
    const recorder = createTeamViewRecorder(3);
    record(recorder, [view(1, { big: 'v1', small: 'v1' })]);
    expect(record(recorder, file('big', 'v1', ['AA', 'BB']))).toEqual([false, false, false, false]);
    record(recorder, file('small', 'v1', ['A']));
    expect(recorder.isComplete).toBe(true);
    expect(recorder.messages().map((message) => message.t)).toEqual(['view', 'file', 'body', 'end']);
    expect(recorder.receive({ t: 'body', id: 'unknown', chunk: 'A' })).toBe(false);
    expect(recorder.receive({ t: 'end', id: 'unknown' })).toBe(false);
    expect(recorder.receive({ t: 'closed', reason: 'gone' })).toBe(false);
    expect(recorder.receive({ t: 'view', data: '{' })).toBe(false);
    expect(recorder.receive({ t: 'view', data: JSON.stringify({ live: true }) })).toBe(false);
    expect(recorder.receive({ t: 'view', data: 'null' })).toBe(false);
    expect(recorder.updatedAt).toBe(1);
  });
});

describe('keeping teammates’ task views on disk', () => {
  test('writes each view to its own file with an index, reads it back after a restart, and removes them', async () => {
    const dir = join(createTempDir(), 'team-views');
    const views = await openTeamViews(dir);
    expect(await views.select('team1', 'inst1', 'task1')).toBeNull();
    await views.write({ ...ENTRY, messages: [view(5)] });
    await views.write({ ...ENTRY, taskId: 'task2', messages: [view(6)] });
    const restarted = await openTeamViews(dir);
    expect((await restarted.list()).map((entry) => entry.taskId)).toEqual(['task1', 'task2']);
    expect(await restarted.selectEntry('team1', 'inst1', 'task1')).toEqual({ ...ENTRY, size: SIZE });
    expect((await restarted.select('team1', 'inst1', 'task1'))?.messages).toEqual([view(5)]);
    await restarted.removeWhere((entry) => entry.taskId === 'task1');
    await restarted.removeWhere(() => false);
    expect(readdirSync(dir)).toHaveLength(2);
    await restarted.removeWhere(() => true);
    expect(existsSync(dir)).toBe(false);
  });

  test('reads a kept view that is not an object as no view', async () => {
    const dir = join(createTempDir(), 'team-views');
    const views = await openTeamViews(dir);
    await views.write({ ...ENTRY, messages: [view(5)] });
    const [kept] = readdirSync(dir).filter((name) => name !== 'index.json');
    writeFileSync(join(dir, String(kept)), '5');
    expect(await views.select('team1', 'inst1', 'task1')).toBeNull();
    writeFileSync(join(dir, String(kept)), '{');
    const logs = captureLogs();
    expect(await views.select('team1', 'inst1', 'task1')).toBeNull();
    logs.restore();
    expect(logs.fieldsOf('[Teams] Could not read a kept team task view')).toEqual([
      { taskId: 'task1', error: expect.any(String) },
    ]);
  });

  test('reads a broken index or view as nothing kept, and logs what it could not write', async () => {
    const dir = join(createTempDir(), 'team-views');
    mkdirSync(dir, { recursive: true });
    const logs = captureLogs();
    writeFileSync(join(dir, 'index.json'), '{');
    expect(await (await openTeamViews(dir)).list()).toEqual([]);
    writeFileSync(
      join(dir, 'index.json'),
      JSON.stringify({ entries: [null, { ...ENTRY, updatedAt: 'x' }, ENTRY, { ...ENTRY, size: 1 }] })
    );
    const views = await openTeamViews(dir);
    expect(await views.list()).toEqual([{ ...ENTRY, size: 1 }]);
    expect(await views.select('team1', 'inst1', 'task1')).toBeNull();
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ entries: 'none' }));
    expect(await (await openTeamViews(dir)).list()).toEqual([]);
    writeFileSync(join(dir, 'index.json'), '[]');
    expect(await (await openTeamViews(dir)).list()).toEqual([]);
    await views.write({ ...ENTRY, messages: [] });
    expect(await views.select('team1', 'inst1', 'task1')).toBeNull();
    const taken = join(createTempDir(), 'taken');
    writeFileSync(taken, 'a file where the folder goes');
    await (await openTeamViews(taken)).write({ ...ENTRY, messages: [view(5)] });
    expect(logs.fieldsOf('[Teams] Could not keep a team task view')).toEqual([
      { dir: taken, error: expect.any(String) },
    ]);
    const blocked = join(createTempDir(), 'blocked');
    mkdirSync(join(blocked, 'index.json', 'inside'), { recursive: true });
    await (await openTeamViews(blocked)).write({ ...ENTRY, messages: [view(5)] });
    logs.restore();
    expect(logs.fieldsOf('[Teams] Could not keep the team task views')).toEqual([
      { dir: blocked, error: expect.any(String) },
    ]);
    expect(logs.fieldsOf('[Teams] Could not read the kept team task views')).toHaveLength(2);
    expect(logs.fieldsOf('[Teams] Could not read a kept team task view')).toHaveLength(1);
  });

  test('logs a folder it could not remove', async () => {
    const parent = createTempDir();
    const dir = join(parent, 'team-views');
    const views = await openTeamViews(dir);
    await views.write({ ...ENTRY, messages: [view(5)] });
    chmodSync(parent, 0o555);
    const logs = captureLogs();
    await views.removeWhere(() => true);
    logs.restore();
    chmodSync(parent, 0o755);
    expect(await views.list()).toEqual([]);
    expect(logs.fieldsOf('[Teams] Could not keep the team task views')).toEqual([
      { dir, error: expect.any(String) },
    ]);
  });

  test('keeps every view under one size limit, emptying the least recently updated first', async () => {
    const dir = join(createTempDir(), 'team-views');
    const views = await openTeamViews(dir, SIZE * 2);
    await views.write({ ...ENTRY, taskId: 'task2', updatedAt: 6, messages: [view(5)] });
    await views.write({ ...ENTRY, messages: [view(5)] });
    await views.write({ ...ENTRY, taskId: 'task3', updatedAt: 4, messages: [view(5)] });
    const restarted = await openTeamViews(dir, SIZE * 2);
    expect((await restarted.selectEntry('team1', 'inst1', 'task1'))?.size).toBe(0);
    expect(await restarted.select('team1', 'inst1', 'task1')).toBeNull();
    expect((await restarted.select('team1', 'inst1', 'task2'))?.messages).toEqual([view(5)]);
    expect((await restarted.select('team1', 'inst1', 'task3'))?.messages).toEqual([view(5)]);
    expect(readdirSync(dir)).toHaveLength(3);
    expect(TEAM_VIEWS_LIMIT).toBe(64 * 1024 * 1024);
  });
});
