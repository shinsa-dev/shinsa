import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { appendFileSync, type FSWatcher, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEntry } from '@shinsa/core';
import { Transcripts, UNREADABLE_LINE } from '../../../src/agents/transcripts/index.ts';
import { until } from '../../helpers/index.ts';

describe('transcripts', () => {
  test('lines appended by another writer reach followers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    const transcripts = new Transcripts(dir);
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'one' });
    const seen: string[] = [];
    transcripts.subscribe((_runId, entries) => {
      for (const entry of entries) if (entry.type === 'agent') seen.push(entry.text);
    });
    const unfollow = transcripts.follow('run-1');
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'two' });
    const external: ChatEntry = { v: 2, id: 'x', at: 3, type: 'agent', phase: 'interim', text: 'three' };
    appendFileSync(join(dir, 'run-1.jsonl'), `${JSON.stringify(external)}\n`);
    await until('the appended line to reach the follower', () => seen.length === 2);
    unfollow();
    expect(seen).toEqual(['two', 'three']);
    expect(transcripts.listEntries('run-1').map((entry) => entry.type === 'agent' && entry.text)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  test('a line torn by a crash is reported, and the next entry is never glued onto it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    const first: ChatEntry = { v: 2, id: 'a', at: 1, type: 'agent', phase: 'interim', text: 'one' };
    writeFileSync(join(dir, 'run-1.jsonl'), `${JSON.stringify(first)}\n{"v":2,"id":"b","ty`);
    const transcripts = new Transcripts(dir);
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'two' });
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'three' });
    const entries = transcripts.listEntries('run-1');
    expect(entries.map((entry) => (entry.type === 'agent' ? entry.text : entry.type))).toEqual([
      'one',
      'error',
      'two',
      'three',
    ]);
    expect(entries[1]).toMatchObject({ type: 'error', text: UNREADABLE_LINE });
    writeFileSync(join(dir, 'run-2.jsonl'), '');
    transcripts.record('run-2', { type: 'agent', phase: 'interim', text: 'fresh' });
    expect(transcripts.listEntries('run-2')).toHaveLength(1);
  });

  test('a line that is not a chat entry reads as an unreadable line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    writeFileSync(
      join(dir, 'other.jsonl'),
      `${JSON.stringify({ at: 1, kind: 'assistant', text: 'hi', tool: null })}\n`
    );
    expect(new Transcripts(dir).listEntries('other')).toMatchObject([
      { type: 'error', text: UNREADABLE_LINE },
    ]);
  });
});

describe('reading a transcript', () => {
  function entryLine(id: string, text: string) {
    return `${JSON.stringify({ v: 2, id, at: 1, type: 'agent', phase: 'interim', text })}\n`;
  }

  test('reads from a position, from the start when the position is past the end, and keeps a half-written last line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    const path = join(dir, 'run-1.jsonl');
    writeFileSync(path, `${entryLine('a', 'one')}${entryLine('b', 'two')}`);
    const transcripts = new Transcripts(dir);
    expect(transcripts.readEntries('run-1', 1).entries.map((entry) => entry.id)).toEqual(['b']);
    expect(transcripts.readEntries('run-1', 1).start).toBe(1);
    expect(transcripts.readEntries('run-1', 9)).toMatchObject({
      start: 0,
      entries: [{ id: 'a' }, { id: 'b' }],
    });
    appendFileSync(path, '{"v":2,"id":"c"');
    expect(transcripts.listEntries('run-1').map((entry) => entry.type)).toEqual(['agent', 'agent', 'error']);
    const torn = transcripts.listEntries('run-1').at(-1);
    expect(torn?.id).toBe(
      `unreadable-${Buffer.byteLength(`${entryLine('a', 'one')}${entryLine('b', 'two')}`)}`
    );
    expect(transcripts.readEntries('missing', 0)).toEqual({ entries: [], start: 0 });
  });

  test('a list it hands out is the caller’s to change', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    writeFileSync(join(dir, 'run-1.jsonl'), `${entryLine('a', 'one')}${entryLine('b', 'two')}`);
    const transcripts = new Transcripts(dir);
    transcripts.listEntries('run-1').reverse();
    expect(transcripts.listEntries('run-1').map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  test('keeps a few recent transcripts read, every followed one, and numbers new entries after what it read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    const transcripts = new Transcripts(dir);
    const starts: [string, number | null][] = [];
    transcripts.subscribe((runId, _entries, start) => starts.push([runId, start]));
    writeFileSync(join(dir, 'followed.jsonl'), entryLine('f', 'followed'));
    const unfollow = transcripts.follow('followed');
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(join(dir, `run-${index}.jsonl`), entryLine(`e${index}`, 'x'));
      expect(transcripts.listEntries(`run-${index}`)).toHaveLength(1);
    }
    transcripts.record('followed', { type: 'agent', phase: 'interim', text: 'next' });
    transcripts.record('run-11', { type: 'agent', phase: 'interim', text: 'next' });
    transcripts.record('run-0', { type: 'agent', phase: 'interim', text: 'next' });
    expect(starts).toEqual([
      ['followed', 1],
      ['run-11', 1],
      ['run-0', null],
    ]);
    unfollow();
  });
});

describe('following a transcript', () => {
  function createWatched(pollMs?: number) {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    const watchers: {
      onChange: () => void;
      emitter: EventEmitter & { close: () => void };
      closed: boolean;
    }[] = [];
    const transcripts = new Transcripts(
      dir,
      (_path, onChange) => {
        const emitter = Object.assign(new EventEmitter(), {
          close: () => {
            watcher.closed = true;
          },
        });
        const watcher = { onChange, emitter, closed: false };
        watchers.push(watcher);
        return emitter as unknown as FSWatcher;
      },
      pollMs
    );
    const seen: string[] = [];
    transcripts.subscribe((runId, entries) => {
      for (const entry of entries) seen.push(`${runId}:${entry.type}`);
    });
    return { dir, transcripts, watchers, seen };
  }

  test('half-written lines wait, a truncated file restarts, a deleted file is ignored', () => {
    const { dir, transcripts, watchers, seen } = createWatched();
    const path = join(dir, 'run-1.jsonl');
    writeFileSync(path, '');
    const unfollow = transcripts.follow('run-1');
    const again = transcripts.follow('run-1');
    expect(watchers).toHaveLength(1);
    const line = JSON.stringify({ v: 2, id: 'x', at: 1, type: 'error', text: 'boom' });
    appendFileSync(path, line.slice(0, 10));
    watchers[0]?.onChange();
    expect(seen).toEqual([]);
    appendFileSync(path, `${line.slice(10)}\nnot json\n`);
    watchers[0]?.onChange();
    expect(seen).toEqual(['run-1:error', 'run-1:error']);
    writeFileSync(path, '');
    watchers[0]?.onChange();
    rmSync(path);
    watchers[0]?.onChange();
    unfollow();
    expect(watchers[0]?.closed).toBe(false);
    again();
    again();
    expect(watchers[0]?.closed).toBe(true);
  });

  test('a watcher error falls back to checking the file, so appended lines still arrive, and a missing transcript is not watched', async () => {
    const { dir, transcripts, watchers, seen } = createWatched();
    const path = join(dir, 'run-2.jsonl');
    writeFileSync(path, '');
    const unfollow = transcripts.follow('run-2');
    watchers[0]?.emitter.emit('error', new Error('EMFILE'));
    expect(watchers[0]?.closed).toBe(true);
    appendFileSync(path, `${JSON.stringify({ v: 2, id: 'y', at: 1, type: 'error', text: 'later' })}\n`);
    await until('the polled line', () => seen.includes('run-2:error'));
    unfollow();
    transcripts.follow('never');
    expect(watchers).toHaveLength(1);
    expect(transcripts.listEntries('never')).toEqual([]);
  });

  test('a change the watch never reports still arrives with the periodic check', async () => {
    const { dir, transcripts, seen } = createWatched(20);
    const path = join(dir, 'run-3.jsonl');
    writeFileSync(path, '');
    const unfollow = transcripts.follow('run-3');
    appendFileSync(path, `${JSON.stringify({ v: 2, id: 'z', at: 1, type: 'error', text: 'missed' })}\n`);
    await until('the line the watch missed', () => seen.includes('run-3:error'));
    unfollow();
  });

  test('an unsubscribed listener hears nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    const transcripts = new Transcripts(dir);
    const seen: unknown[] = [];
    const unsubscribe = transcripts.subscribe((_runId, entries) => seen.push(...entries));
    unsubscribe();
    transcripts.record('r', { type: 'error', text: 'x' });
    expect(seen).toEqual([]);
  });
});
