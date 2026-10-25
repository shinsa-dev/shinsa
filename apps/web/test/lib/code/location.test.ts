import { describe, expect, it } from 'bun:test';
import {
  parseCodeLocation,
  resolveClearPatch,
  resolveFileKey,
  resolveModePatch,
  resolveOpenPatch,
  resolveSearchPatch,
} from '@/lib/code/location.ts';

const MODES = ['changes', 'files'] as const;

function parse(query: string, modes = [...MODES]) {
  const params = new URLSearchParams(query);
  return parseCodeLocation((name) => params.get(name), modes);
}

describe('parseCodeLocation', () => {
  it('reads every view position from the URL', () => {
    const location = parse(
      'mode=changes&file=a.ts&diff=1&line=4&end=9&ref=abc&spot=1%3A2&q=needle&regex=1&case=1&word=1&glob=*.ts'
    );
    expect(location).toEqual({
      mode: 'changes',
      active: { kind: 'diff', path: 'a.ts' },
      line: 4,
      end: 9,
      ref: 'abc',
      spot: '1:2',
      query: 'needle',
      regex: true,
      caseSensitive: true,
      wholeWord: true,
      glob: '*.ts',
    });
    expect(parse('file=src%2Fb.ts').active).toEqual({ kind: 'file', path: 'src/b.ts' });
  });

  it('falls back to the first mode the task has, keeps search always, and ignores what makes no sense', () => {
    expect(parse('mode=changes', ['files']).mode).toBe('files');
    expect(parse('mode=review').mode).toBe('changes');
    expect(parse('mode=search', ['files']).mode).toBe('search');
    expect(parse('').mode).toBe('changes');
    expect(parse('', []).mode).toBe('files');
    const location = parse('line=0&end=2');
    expect(location).toMatchObject({ line: null, end: null, active: null });
    expect(parse('line=9&end=3').end).toBeNull();
  });
});

describe('opening a file', () => {
  it('replaces the open file and its position, and keys a diff apart from the file', () => {
    expect(resolveOpenPatch({ kind: 'file', path: 'a.ts' }, { line: 3, end: 5, spot: 's' })).toEqual({
      file: 'a.ts',
      diff: null,
      line: '3',
      end: '5',
      spot: 's',
    });
    expect(resolveOpenPatch({ kind: 'diff', path: 'b.ts' }, { line: 3, end: 3 })).toEqual({
      file: 'b.ts',
      diff: '1',
      line: '3',
      end: null,
      spot: null,
    });
    expect(resolveOpenPatch({ kind: 'diff', path: 'b.ts' })).toMatchObject({ line: null, end: null });
    expect(resolveFileKey({ kind: 'diff', path: 'a.ts' })).not.toBe(
      resolveFileKey({ kind: 'file', path: 'a.ts' })
    );
  });
});

describe('patches', () => {
  it('leave the default mode out of the URL and write the search', () => {
    expect(resolveModePatch('changes', [...MODES])).toEqual({ mode: null });
    expect(resolveModePatch('files', [...MODES])).toEqual({ mode: 'files' });
    expect(
      resolveSearchPatch({ query: 'x', regex: true, caseSensitive: false, wholeWord: true, glob: ' ' })
    ).toEqual({
      mode: 'search',
      q: 'x',
      regex: '1',
      case: null,
      word: '1',
      glob: null,
    });
    expect(
      resolveSearchPatch({ query: '', regex: false, caseSensitive: true, wholeWord: false, glob: '*.md' })
    ).toMatchObject({
      q: null,
      case: '1',
      word: null,
      glob: '*.md',
    });
    expect(Object.values(resolveClearPatch()).every((value) => value === null)).toBe(true);
  });
});
