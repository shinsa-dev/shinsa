import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { appendFileSync, type FSWatcher, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEntry } from '@shinsa/core';
import { readChatEntries, Transcripts } from '../../../src/agents/transcripts/index.ts';

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
    await Bun.sleep(200);
    unfollow();
    expect(seen).toEqual(['two', 'three']);
    expect(transcripts.listEntries('run-1').map((entry) => entry.type === 'agent' && entry.text)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  test('a legacy file reads as chat entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    writeFileSync(
      join(dir, 'old.jsonl'),
      `${JSON.stringify({ at: 1, kind: 'assistant', text: 'hi', tool: null })}\n`
    );
    expect(new Transcripts(dir).listEntries('old')).toMatchObject([
      { type: 'agent', phase: 'final', text: 'hi' },
    ]);
  });
});

describe('readChatEntries', () => {
  test('old Claude-shaped transcripts are migrated on read', () => {
    const entries = readChatEntries([
      { at: 1, kind: 'prompt', text: 'Work on: retry', tool: null, source: 'shinsa' },
      { at: 2, kind: 'assistant', text: 'Starting.', tool: null },
      {
        at: 3,
        kind: 'tool',
        text: 'bun run dev',
        tool: 'Bash',
        toolUseId: 't1',
        input: '{"command":"bun run dev"',
      },
      {
        at: 4,
        kind: 'tool_result',
        text: '<tool_use_error>boom</tool_use_error>',
        tool: null,
        toolUseId: 't1',
      },
      {
        at: 5,
        kind: 'tool',
        text: 'x',
        tool: 'mcp__shinsa__complete_phase',
        toolUseId: 't2',
        input: '{"summary":"Done."}',
      },
      { at: 6, kind: 'assistant', text: 'Handed over.', tool: null },
      { at: 7, kind: 'error', text: 'Crashed.', tool: null },
      { v: 2, id: 'now', at: 8, type: 'error', text: 'Current.' },
      { at: 9, kind: 'mystery', text: '?', tool: null },
    ]);
    expect(entries).toMatchObject([
      { v: 2, at: 1, type: 'user', from: 'shinsa', text: 'Work on: retry' },
      { at: 2, type: 'agent', phase: 'interim', text: 'Starting.' },
      { at: 3, type: 'tool_call', callId: 't1', tool: { kind: 'command', command: 'bun run dev' } },
      { at: 4, type: 'tool_result', callId: 't1', status: 'error', output: 'boom' },
      {
        at: 5,
        type: 'tool_call',
        tool: { kind: 'shinsa', name: 'complete_phase', args: { summary: 'Done.' } },
      },
      { at: 6, type: 'agent', phase: 'final', text: 'Handed over.' },
      { at: 7, type: 'error', text: 'Crashed.' },
      { id: 'now', type: 'error', text: 'Current.' },
    ]);
  });

  test('current entries pass through untouched', () => {
    const entry: ChatEntry = { v: 2, id: 'a', at: 1, type: 'error', text: 'boom' };
    expect(readChatEntries([entry])).toEqual([entry]);
  });
});

describe('following a transcript', () => {
  function createWatched() {
    const dir = mkdtempSync(join(tmpdir(), 'shinsa-transcripts-'));
    const watchers: {
      onChange: () => void;
      emitter: EventEmitter & { close: () => void };
      closed: boolean;
    }[] = [];
    const transcripts = new Transcripts(dir, (_path, onChange) => {
      const emitter = Object.assign(new EventEmitter(), {
        close: () => {
          watcher.closed = true;
        },
      });
      const watcher = { onChange, emitter, closed: false };
      watchers.push(watcher);
      return emitter as unknown as FSWatcher;
    });
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
    expect(seen).toEqual(['run-1:error']);
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

  test('a watcher error stops following without crashing, and a missing transcript is not watched', () => {
    const { dir, transcripts, watchers } = createWatched();
    writeFileSync(join(dir, 'run-2.jsonl'), '');
    transcripts.follow('run-2');
    watchers[0]?.emitter.emit('error', new Error('EMFILE'));
    expect(watchers[0]?.closed).toBe(true);
    transcripts.follow('never');
    expect(watchers).toHaveLength(1);
    expect(transcripts.listEntries('never')).toEqual([]);
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
