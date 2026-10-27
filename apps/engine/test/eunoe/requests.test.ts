import { describe, expect, spyOn, test } from 'bun:test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatNotice } from '@shinsa/core';
import { EunoeRequestWatch, resolveCompactionNotice } from '../../src/eunoe/requests.ts';
import { log } from '../../src/log/index.ts';
import { createTempDir, until } from '../helpers/index.ts';

function line(record: Record<string, unknown>) {
  return `${JSON.stringify({ ts: '2026-10-23T10:00:00.000Z', ...record })}\n`;
}

const FOLD: ChatNotice = { kind: 'compaction', trigger: 'fold', preTokens: null, summary: null, by: 'eunoe' };

const CUT: ChatNotice = { ...FOLD, trigger: 'auto' };

describe('resolveCompactionNotice', () => {
  test('a cut is eunoe’s compaction, a roll is a fold, and a request that changed nothing is no notice', () => {
    expect(resolveCompactionNotice({ compacted: true, actions: ['cut', 'keep=2'] })).toEqual(CUT);
    expect(resolveCompactionNotice({ compacted: true, actions: ['roll'] })).toEqual(FOLD);
    expect(resolveCompactionNotice({ compacted: true })).toEqual(FOLD);
    expect(resolveCompactionNotice({ compacted: false, actions: ['cut'] })).toBeNull();
  });
});

describe('watching eunoe’s request log', () => {
  test('hands each session the folds of its own thread that eunoe logs after the watch starts', async () => {
    const path = join(createTempDir(), 'requests.jsonl');
    writeFileSync(path, line({ thread: 'sess-a-0', compacted: true, actions: ['cut'] }));
    const watch = new EunoeRequestWatch(path, 5);
    const a: ChatNotice[] = [];
    const b: ChatNotice[] = [];
    const stopA = watch.watch('sess-a', (notice) => a.push(notice));
    const stopB = watch.watch('sess-b', (notice) => b.push(notice));
    appendFileSync(path, line({ thread: 'sess-a-1', compacted: true, actions: ['roll'] }));
    appendFileSync(path, line({ thread: 'sess-b-1', compacted: false }));
    appendFileSync(path, line({ thread: 'sess-ab-1', compacted: true, actions: ['cut'] }));
    appendFileSync(path, `not json\n${line({ path: '/v1/models' })}`);
    await until('the fold', () => a.length === 1);
    appendFileSync(path, line({ thread: 'sess-b-2', compacted: true, actions: ['cut'] }).slice(0, 20));
    watch.read();
    expect(b).toEqual([]);
    appendFileSync(path, line({ thread: 'sess-b-2', compacted: true, actions: ['cut'] }).slice(20));
    stopB();
    expect(b).toEqual([CUT]);
    expect(a).toEqual([FOLD]);
    stopA();
    appendFileSync(path, line({ thread: 'sess-a-2', compacted: true }));
    watch.read();
    expect(a).toEqual([FOLD]);
  });

  test('starts over when the log is replaced, and logs a log it cannot read', () => {
    const dir = createTempDir();
    const path = join(dir, 'requests.jsonl');
    writeFileSync(path, `${line({ thread: 'old-1' })}${line({ thread: 'old-2' })}`);
    const watch = new EunoeRequestWatch(path, 60_000);
    const seen: ChatNotice[] = [];
    const stop = watch.watch('sess-a', (notice) => seen.push(notice));
    writeFileSync(path, line({ thread: 'sess-a-1', compacted: true, actions: ['cut'] }));
    watch.read();
    expect(seen).toEqual([CUT]);
    stop();

    const folder = join(dir, 'folder.jsonl');
    const unreadable = new EunoeRequestWatch(folder, 60_000);
    const quiet = unreadable.watch('sess-a', () => undefined);
    mkdirSync(folder);
    writeFileSync(join(folder, 'x'), 'x');
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    unreadable.read();
    quiet();
    expect(warn.mock.calls.some(([message]) => message === '[Eunoe] Could not read the request log')).toBe(
      true
    );
    warn.mockRestore();
  });
});
