import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShareMessage } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { TeamViewRecorder, TeamViews } from '../../src/remote/team-views.ts';
import { createTempDir } from '../helpers/index.ts';

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

describe('recording a teammate’s task view', () => {
  test('keeps the latest view and each file it lists, complete once every listed file came', () => {
    const recorder = new TeamViewRecorder();
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
    const recorder = new TeamViewRecorder(3);
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
  test('writes each view to its own file with an index, reads it back after a restart, and removes them', () => {
    const dir = join(createTempDir(), 'team-views');
    const views = new TeamViews(dir);
    expect(views.select('team1', 'inst1', 'task1')).toBeNull();
    views.write({ ...ENTRY, messages: [view(5)] });
    views.write({ ...ENTRY, taskId: 'task2', messages: [view(6)] });
    const restarted = new TeamViews(dir);
    expect(restarted.list().map((entry) => entry.taskId)).toEqual(['task1', 'task2']);
    expect(restarted.selectEntry('team1', 'inst1', 'task1')).toEqual(ENTRY);
    expect(restarted.select('team1', 'inst1', 'task1')?.messages).toEqual([view(5)]);
    restarted.removeWhere((entry) => entry.taskId === 'task1');
    restarted.removeWhere(() => false);
    expect(readdirSync(dir)).toHaveLength(2);
    restarted.removeWhere(() => true);
    expect(existsSync(dir)).toBe(false);
  });

  test('reads a broken index or view as nothing kept, and logs what it could not write', () => {
    const dir = join(createTempDir(), 'team-views');
    mkdirSync(dir, { recursive: true });
    const warn = spyOn(log, 'warn');
    writeFileSync(join(dir, 'index.json'), '{');
    expect(new TeamViews(dir).list()).toEqual([]);
    writeFileSync(
      join(dir, 'index.json'),
      JSON.stringify({ entries: [null, { ...ENTRY, updatedAt: 'x' }, ENTRY] })
    );
    const views = new TeamViews(dir);
    expect(views.list()).toEqual([ENTRY]);
    expect(views.select('team1', 'inst1', 'task1')).toBeNull();
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ entries: 'none' }));
    expect(new TeamViews(dir).list()).toEqual([]);
    views.write({ ...ENTRY, messages: [] });
    expect(views.select('team1', 'inst1', 'task1')).toBeNull();
    const taken = join(createTempDir(), 'taken');
    writeFileSync(taken, 'a file where the folder goes');
    new TeamViews(taken).write({ ...ENTRY, messages: [view(5)] });
    expect(warn).toHaveBeenCalledWith('[Teams] Could not keep a team task view', expect.anything());
    const blocked = join(createTempDir(), 'blocked');
    mkdirSync(join(blocked, 'index.json', 'inside'), { recursive: true });
    new TeamViews(blocked).write({ ...ENTRY, messages: [view(5)] });
    expect(warn).toHaveBeenCalledWith('[Teams] Could not keep the team task views', expect.anything());
    warn.mockRestore();
  });
});
