import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { appendFileSync, type FSWatcher, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEntry } from '@shinsa/core';
import { Context, Duration, Effect, Layer, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { type FileWatcher, UNREADABLE_LINE } from '../../../src/agents/transcripts/schema.ts';
import { Transcripts } from '../../../src/agents/transcripts/service.ts';
import { JsonLogger } from '../../../src/log/service.ts';
import { captureLogs } from '../../helpers/logs.ts';
import { createTranscriptsLayer } from '../../helpers/transcripts.ts';

interface FakeWatcher {
  onChange: () => void;
  emitter: EventEmitter & { close: () => void };
  closed: boolean;
}

function run<A, E>(effect: Effect.Effect<A, E, Scope.Scope>) {
  return Effect.runPromise(
    Effect.scoped(effect).pipe(Effect.provide(Layer.merge(TestClock.layer(), JsonLogger)))
  );
}

const build = Effect.fn('test.build')(function* (dir: string, watch?: FileWatcher) {
  return Context.get(yield* Layer.build(createTranscriptsLayer(dir, watch)), Transcripts);
});

const tick = TestClock.adjust(Duration.seconds(1));

function createDir() {
  return mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
}

const createWatched = Effect.fn('test.createWatched')(function* () {
  const dir = createDir();
  const watchers: FakeWatcher[] = [];
  const transcripts = yield* build(dir, (_path, onChange) => {
    const emitter = Object.assign(new EventEmitter(), {
      close: () => {
        watcher.closed = true;
      },
    });
    const watcher: FakeWatcher = { onChange, emitter, closed: false };
    watchers.push(watcher);
    return emitter as unknown as FSWatcher;
  });
  const seen: string[] = [];
  yield* Effect.asVoid(
    transcripts.subscribe((runId, entries) => {
      for (const entry of entries) seen.push(`${runId}:${entry.type}`);
    })
  );
  return { dir, transcripts, watchers, seen };
});

function errorLine(id: string, text: string) {
  return `${JSON.stringify({ v: 2, id, at: 1, type: 'error', text })}\n`;
}

setDefaultTimeout(30_000);

describe('transcripts', () => {
  test('lines appended by another writer reach followers', () =>
    run(
      Effect.gen(function* () {
        const { dir, transcripts, watchers } = yield* createWatched();
        yield* transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'one' });
        const seen: string[] = [];
        yield* Effect.asVoid(
          transcripts.subscribe((_runId, entries) => {
            for (const entry of entries) if (entry.type === 'agent') seen.push(entry.text);
          })
        );
        const unfollow = yield* transcripts.follow('run-1');
        yield* transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'two' });
        const external: ChatEntry = { v: 2, id: 'x', at: 3, type: 'agent', phase: 'interim', text: 'three' };
        appendFileSync(join(dir, 'run-1.jsonl'), `${JSON.stringify(external)}\n`);
        watchers[0]?.onChange();
        yield* unfollow;
        expect(seen).toEqual(['two', 'three']);
        const entries = yield* transcripts.listEntries('run-1');
        expect(entries.map((entry) => entry.type === 'agent' && entry.text)).toEqual(['one', 'two', 'three']);
      })
    ));

  test('a line torn by a crash is reported, and the next entry is never glued onto it', () =>
    run(
      Effect.gen(function* () {
        const dir = createDir();
        const first: ChatEntry = { v: 2, id: 'a', at: 1, type: 'agent', phase: 'interim', text: 'one' };
        writeFileSync(join(dir, 'run-1.jsonl'), `${JSON.stringify(first)}\n{"v":2,"id":"b","ty`);
        const transcripts = yield* build(dir);
        yield* transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'two' });
        yield* transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'three' });
        const entries = yield* transcripts.listEntries('run-1');
        expect(entries.map((entry) => (entry.type === 'agent' ? entry.text : entry.type))).toEqual([
          'one',
          'error',
          'two',
          'three',
        ]);
        expect(entries[1]).toMatchObject({ type: 'error', text: UNREADABLE_LINE });
        writeFileSync(join(dir, 'run-2.jsonl'), '');
        yield* transcripts.record('run-2', { type: 'agent', phase: 'interim', text: 'fresh' });
        expect(yield* transcripts.listEntries('run-2')).toHaveLength(1);
      })
    ));

  test('a line that is not a chat entry reads as an unreadable line', () =>
    run(
      Effect.gen(function* () {
        const dir = createDir();
        writeFileSync(
          join(dir, 'other.jsonl'),
          `${JSON.stringify({ at: 1, kind: 'assistant', text: 'hi', tool: null })}\n`
        );
        const transcripts = yield* build(dir);
        expect(yield* transcripts.listEntries('other')).toMatchObject([
          { type: 'error', text: UNREADABLE_LINE },
        ]);
        expect(transcripts.resolvePath('ru/n:1')).toBe(join(dir, 'run1.jsonl'));
      })
    ));

  test('a line it cannot write is logged, and nobody hears an entry that is not on disk', () =>
    run(
      Effect.gen(function* () {
        const dir = join(createDir(), 'missing');
        const transcripts = yield* build(dir);
        const heard: ChatEntry[] = [];
        const unsubscribe = yield* transcripts.subscribe((_runId, entries) => {
          heard.push(...entries);
        });
        const logs = captureLogs();
        yield* transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'done' });
        logs.restore();
        expect(logs.fieldsOf('[Transcripts] Could not write a line of the transcript')).toMatchObject([
          { runId: 'run-1', error: expect.stringContaining('ENOENT') },
        ]);
        expect(heard).toEqual([]);
        yield* unsubscribe;
      })
    ));
});

describe('reading a transcript', () => {
  function entryLine(id: string, text: string) {
    return `${JSON.stringify({ v: 2, id, at: 1, type: 'agent', phase: 'interim', text })}\n`;
  }

  test('reads from a position, from the start when the position is past the end, and keeps a half-written last line', () =>
    run(
      Effect.gen(function* () {
        const dir = createDir();
        const path = join(dir, 'run-1.jsonl');
        writeFileSync(path, `${entryLine('a', 'one')}${entryLine('b', 'two')}`);
        const transcripts = yield* build(dir);
        const read = yield* transcripts.readEntries('run-1', 1);
        expect(read.entries.map((entry) => entry.id)).toEqual(['b']);
        expect(read.start).toBe(1);
        expect(yield* transcripts.readEntries('run-1', 9)).toMatchObject({
          start: 0,
          entries: [{ id: 'a' }, { id: 'b' }],
        });
        appendFileSync(path, '{"v":2,"id":"c"');
        const entries = yield* transcripts.listEntries('run-1');
        expect(entries.map((entry) => entry.type)).toEqual(['agent', 'agent', 'error']);
        expect(entries.at(-1)?.id).toBe(
          `unreadable-${Buffer.byteLength(`${entryLine('a', 'one')}${entryLine('b', 'two')}`)}`
        );
        expect(yield* transcripts.readEntries('missing', 0)).toEqual({ entries: [], start: 0 });
      })
    ));

  test('a list it hands out is the caller’s to change', () =>
    run(
      Effect.gen(function* () {
        const dir = createDir();
        writeFileSync(join(dir, 'run-1.jsonl'), `${entryLine('a', 'one')}${entryLine('b', 'two')}`);
        const transcripts = yield* build(dir);
        (yield* transcripts.listEntries('run-1')).reverse();
        expect((yield* transcripts.listEntries('run-1')).map((entry) => entry.id)).toEqual(['a', 'b']);
      })
    ));

  test('keeps a few recent transcripts read, every followed one, and numbers new entries after what it read', () =>
    run(
      Effect.gen(function* () {
        const dir = createDir();
        const transcripts = yield* build(dir);
        const starts: [string, number | null][] = [];
        yield* Effect.asVoid(transcripts.subscribe((runId, _entries, start) => starts.push([runId, start])));
        writeFileSync(join(dir, 'followed.jsonl'), entryLine('f', 'followed'));
        const unfollow = yield* transcripts.follow('followed');
        for (let index = 0; index < 12; index += 1) {
          writeFileSync(join(dir, `run-${index}.jsonl`), entryLine(`e${index}`, 'x'));
          expect(yield* transcripts.listEntries(`run-${index}`)).toHaveLength(1);
        }
        yield* transcripts.record('followed', { type: 'agent', phase: 'interim', text: 'next' });
        yield* transcripts.record('run-11', { type: 'agent', phase: 'interim', text: 'next' });
        yield* transcripts.record('run-0', { type: 'agent', phase: 'interim', text: 'next' });
        expect(starts).toEqual([
          ['followed', 1],
          ['run-11', 1],
          ['run-0', null],
        ]);
        yield* unfollow;
      })
    ));
});

describe('following a transcript', () => {
  test('half-written lines wait, a truncated file restarts, a deleted file is ignored', () =>
    run(
      Effect.gen(function* () {
        const { dir, transcripts, watchers, seen } = yield* createWatched();
        const path = join(dir, 'run-1.jsonl');
        writeFileSync(path, '');
        const unfollow = yield* transcripts.follow('run-1');
        const again = yield* transcripts.follow('run-1');
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
        yield* unfollow;
        expect(watchers[0]?.closed).toBe(false);
        yield* again;
        yield* again;
        expect(watchers[0]?.closed).toBe(true);
        writeFileSync(path, errorLine('after', 'after'));
        yield* tick;
        expect(seen).toEqual(['run-1:error', 'run-1:error']);
      })
    ));

  test('a watcher error falls back to checking the file, so appended lines still arrive, and a missing transcript is not watched', () =>
    run(
      Effect.gen(function* () {
        const logs = captureLogs();
        const { dir, transcripts, watchers, seen } = yield* createWatched();
        const path = join(dir, 'run-2.jsonl');
        writeFileSync(path, '');
        const unfollow = yield* transcripts.follow('run-2');
        watchers[0]?.emitter.emit('error', new Error('EMFILE'));
        expect(watchers[0]?.closed).toBe(true);
        appendFileSync(path, errorLine('y', 'later'));
        yield* tick;
        expect(seen).toEqual(['run-2:error']);
        yield* Effect.yieldNow;
        expect(
          logs.fieldsOf('[Transcripts] Watching a transcript failed; the check every second carries on')
        ).toEqual([{ runId: 'run-2', error: 'EMFILE' }]);
        logs.restore();
        yield* unfollow;
        appendFileSync(path, errorLine('z', 'unheard'));
        yield* tick;
        expect(seen).toEqual(['run-2:error']);
        const unfollowMissing = yield* transcripts.follow('never');
        expect(watchers).toHaveLength(1);
        expect(yield* transcripts.listEntries('never')).toEqual([]);
        yield* unfollowMissing;
      })
    ));

  test('a line appended right after following arrives at the next check, though the watch never reports it', () =>
    run(
      Effect.gen(function* () {
        const { dir, transcripts, seen } = yield* createWatched();
        const path = join(dir, 'run-3.jsonl');
        writeFileSync(path, '');
        const unfollow = yield* transcripts.follow('run-3');
        appendFileSync(path, errorLine('z', 'missed'));
        yield* tick;
        yield* tick;
        expect(seen).toEqual(['run-3:error']);
        yield* unfollow;
      })
    ));

  test('follows with the file system watch by default', () =>
    run(
      Effect.gen(function* () {
        const dir = createDir();
        const path = join(dir, 'run-4.jsonl');
        writeFileSync(path, '');
        const transcripts = yield* build(dir);
        const seen: string[] = [];
        yield* Effect.asVoid(
          transcripts.subscribe((runId, entries) => {
            for (const entry of entries) seen.push(`${runId}:${entry.type}`);
          })
        );
        const unfollow = yield* transcripts.follow('run-4');
        appendFileSync(path, errorLine('w', 'checked'));
        yield* tick;
        expect(seen).toEqual(['run-4:error']);
        yield* unfollow;
      })
    ));

  test('an unsubscribed listener hears nothing', () =>
    run(
      Effect.gen(function* () {
        const transcripts = yield* build(createDir());
        const seen: unknown[] = [];
        const unsubscribe = yield* transcripts.subscribe((_runId, entries) => seen.push(...entries));
        yield* unsubscribe;
        yield* transcripts.record('r', { type: 'error', text: 'x' });
        expect(seen).toEqual([]);
      })
    ));
});
