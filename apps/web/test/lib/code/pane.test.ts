import { describe, expect, it } from 'bun:test';
import type { FileContent } from '@shinsa/core';
import {
  holdPaneContent,
  listKeptLines,
  resolvePaneContent,
  resolveTextGuard,
  TEXT_GUARD,
} from '@/lib/code/pane.ts';
import type { Loaded } from '@/lib/connection/code.ts';

function ready(content: string | null, overrides: Partial<FileContent> = {}): Loaded<FileContent> {
  return {
    status: 'ready',
    value: {
      ref: 'r',
      path: 'a.ts',
      content,
      size: 1,
      binary: false,
      tooLarge: false,
      missing: content === null,
      image: null,
      ...overrides,
    },
  };
}

const LOADING: Loaded<FileContent> = { status: 'loading' };
const IDLE: Loaded<FileContent> = { status: 'idle' };

describe('resolvePaneContent', () => {
  it('waits for both sides of a diff, and for nothing a side does not have', () => {
    expect(
      resolvePaneContent({ headPath: 'a', basePath: 'a', diffing: true, head: ready('x'), base: LOADING })
    ).toEqual({ kind: 'waiting' });
    expect(
      resolvePaneContent({ headPath: 'a', basePath: null, diffing: false, head: IDLE, base: IDLE })
    ).toEqual({ kind: 'waiting' });
    expect(
      resolvePaneContent({ headPath: 'a', basePath: 'a', diffing: false, head: ready('x'), base: LOADING })
    ).toEqual({
      kind: 'text',
      content: 'x',
      original: null,
    });
  });

  it('shows an added file against nothing and a deleted one against its last text', () => {
    expect(
      resolvePaneContent({ headPath: 'a', basePath: null, diffing: true, head: ready('new'), base: IDLE })
    ).toEqual({
      kind: 'text',
      content: 'new',
      original: '',
    });
    expect(
      resolvePaneContent({ headPath: null, basePath: 'a', diffing: true, head: IDLE, base: ready('old') })
    ).toEqual({
      kind: 'text',
      content: '',
      original: 'old',
    });
  });

  it('says why when a side failed or has no text', () => {
    const error: Loaded<FileContent> = { status: 'error', message: 'No such commit.' };
    expect(
      resolvePaneContent({ headPath: 'a', basePath: 'a', diffing: true, head: error, base: ready('x') })
    ).toEqual({
      kind: 'failed',
      message: 'No such commit.',
    });
    expect(
      resolvePaneContent({ headPath: 'a', basePath: 'a', diffing: true, head: ready('x'), base: error })
    ).toEqual({
      kind: 'failed',
      message: 'No such commit.',
    });
    const binary = ready(null, { binary: true });
    expect(
      resolvePaneContent({ headPath: 'a', basePath: null, diffing: false, head: binary, base: IDLE })
    ).toEqual({
      kind: 'absent',
      head: binary.status === 'ready' ? binary.value : null,
    });
    expect(
      resolvePaneContent({ headPath: 'a', basePath: 'a', diffing: true, head: ready('x'), base: ready(null) })
    ).toMatchObject({
      kind: 'absent',
    });
    expect(
      resolvePaneContent({ headPath: null, basePath: 'a', diffing: true, head: IDLE, base: ready(null) })
    ).toEqual({
      kind: 'absent',
      head: null,
    });
  });
});

describe('listKeptLines', () => {
  it('keeps the lines notes, spots and the asked-for line sit on out of the folds', () => {
    expect(
      listKeptLines(
        [
          { kind: 'composer', key: 'c', side: 'new', line: 4, start: 4, endLine: null },
          { kind: 'composer', key: 'o', side: 'old', line: 9, start: 9, endLine: null },
        ],
        [{ key: 's', from: 10, to: 12, tone: 'red', selected: false }],
        20,
        null
      )
    ).toEqual([4, 10, 12, 20, 20]);
    expect(listKeptLines([], [], null, null)).toEqual([]);
  });
});

describe('holdPaneContent', () => {
  it('keeps the text on screen while the same file is read again, and takes anything else as it comes', () => {
    const text = { kind: 'text', content: 'a', original: null } as const;
    const waiting = { kind: 'waiting' } as const;
    expect(holdPaneContent(text, waiting)).toBe(text);
    expect(holdPaneContent(null, waiting)).toBe(waiting);
    expect(holdPaneContent(text, { kind: 'failed', message: 'x' })).toEqual({ kind: 'failed', message: 'x' });
    expect(holdPaneContent({ kind: 'absent', head: null }, waiting)).toBe(waiting);
  });
});

describe('resolveTextGuard', () => {
  it('stops a file too large or with a line too long before it reaches the editor', () => {
    expect(resolveTextGuard('a.ts', ['short\nlines\n', null])).toBeNull();
    expect(resolveTextGuard('a.ts', ['x'.repeat(TEXT_GUARD.bytes + 1)])).toBe(
      'a.ts is 1.0 MB, too large to show as text.'
    );
    expect(resolveTextGuard('min.js', [`a\n${'x'.repeat(TEXT_GUARD.lineLength + 1)}\nb`, 'old'])).toBe(
      'min.js has a line of 10,001 characters, too long to show as text.'
    );
    expect(resolveTextGuard('min.js', ['new', `${'y'.repeat(TEXT_GUARD.lineLength + 5)}`])).toContain(
      '10,005'
    );
  });
});
