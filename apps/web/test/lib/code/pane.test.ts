import { describe, expect, it } from 'bun:test';
import type { FileContent } from '@shinsa/core';
import { listKeptLines, resolvePaneContent } from '@/lib/code/pane.ts';
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
