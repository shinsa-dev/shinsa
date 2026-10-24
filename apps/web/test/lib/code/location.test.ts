import { describe, expect, it } from 'bun:test';
import {
  type CodeLocation,
  MAX_TABS,
  parseCodeLocation,
  parseTabs,
  resolveClearPatch,
  resolveClosePatch,
  resolveModePatch,
  resolveOpenPatch,
  resolvePinPatch,
  resolveSearchPatch,
  serializeTabs,
} from '@/lib/code/location.ts';

const MODES = ['review', 'changes', 'files'] as const;

function parse(query: string, modes = [...MODES]) {
  const params = new URLSearchParams(query);
  return parseCodeLocation((name) => params.get(name), modes);
}

function apply(location: CodeLocation, patch: Record<string, string | null>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    mode: location.mode,
    open: serializeTabs(location.tabs),
    file: location.active?.path ?? null,
    diff: location.active?.kind === 'diff' ? '1' : null,
    preview: location.preview,
    ...patch,
  })) {
    if (value !== null) params.set(key, value);
  }
  return parse(params.toString());
}

describe('parseCodeLocation', () => {
  it('reads every view position from the URL', () => {
    const location = parse(
      'mode=changes&open=d%3Aa.ts,f%3Asrc%2Fb.ts&file=a.ts&diff=1&line=4&end=9&ref=abc&spot=1%3A2&order=attention&q=needle&regex=1&case=1&glob=*.ts&preview=f%3Asrc%2Fb.ts'
    );
    expect(location).toEqual({
      mode: 'changes',
      tabs: [
        { kind: 'diff', path: 'a.ts' },
        { kind: 'file', path: 'src/b.ts' },
      ],
      active: { kind: 'diff', path: 'a.ts' },
      preview: 'f:src/b.ts',
      line: 4,
      end: 9,
      ref: 'abc',
      spot: '1:2',
      order: 'attention',
      query: 'needle',
      regex: true,
      caseSensitive: true,
      glob: '*.ts',
    });
  });

  it('falls back to the first mode the task has, keeps search always, and ignores what makes no sense', () => {
    expect(parse('mode=review', ['files']).mode).toBe('files');
    expect(parse('mode=search', ['files']).mode).toBe('search');
    expect(parse('').mode).toBe('review');
    expect(parse('', []).mode).toBe('files');
    const location = parse('line=0&end=2&order=sideways&open=x:a,d:,%E0%A4%A');
    expect(location).toMatchObject({ line: null, end: null, order: 'walkthrough', tabs: [] });
    expect(parse('line=9&end=3').end).toBeNull();
  });

  it('adds the open file to the tabs when the list leaves it out, once', () => {
    expect(parse('file=a.ts').tabs).toEqual([{ kind: 'file', path: 'a.ts' }]);
    expect(parse('open=f%3Aa.ts,f%3Aa.ts&file=a.ts').tabs).toEqual([{ kind: 'file', path: 'a.ts' }]);
  });
});

describe('tabs in the URL', () => {
  it('survive paths with commas and percent signs', () => {
    const tabs = [
      { kind: 'file' as const, path: 'docs/a,b.md' },
      { kind: 'diff' as const, path: 'src/100%.ts' },
    ];
    expect(parseTabs(serializeTabs(tabs))).toEqual(tabs);
    expect(serializeTabs([])).toBeNull();
  });
});

describe('opening and closing tabs', () => {
  it('opens a file as the preview, which the next one replaces in place', () => {
    const start = parse('');
    const first = apply(
      start,
      resolveOpenPatch(start, { kind: 'file', path: 'a.ts' }, { line: 3, end: 5, spot: 's' })
    );
    expect(first).toMatchObject({ preview: 'f:a.ts', line: 3, end: 5, spot: 's' });
    const patch = resolveOpenPatch(first, { kind: 'diff', path: 'b.ts' });
    expect(patch).toMatchObject({ file: 'b.ts', diff: '1', preview: 'd:b.ts', line: null, spot: null });
    expect(apply(first, patch).tabs).toEqual([{ kind: 'diff', path: 'b.ts' }]);
    expect(
      resolveOpenPatch(start, { kind: 'file', path: 'a.ts' }, { line: 3, end: 5, spot: 's' })
    ).toMatchObject({
      line: '3',
      end: '5',
      spot: 's',
    });
  });

  it('pins a tab that is opened to stay, and keeps pinned tabs when another opens', () => {
    const start = parse('');
    const pinned = apply(start, resolveOpenPatch(start, { kind: 'file', path: 'a.ts' }, { pin: true }));
    expect(pinned.preview).toBeNull();
    const second = apply(pinned, resolveOpenPatch(pinned, { kind: 'file', path: 'b.ts' }));
    expect(second.tabs.map((tab) => tab.path)).toEqual(['a.ts', 'b.ts']);
    expect(resolvePinPatch(second, { kind: 'file', path: 'b.ts' })).toEqual({ preview: null });
    expect(resolvePinPatch(second, { kind: 'file', path: 'a.ts' })).toEqual({});
    expect(resolveOpenPatch(second, { kind: 'file', path: 'b.ts' }, { pin: true }).preview).toBeNull();
    expect(resolveOpenPatch(second, { kind: 'file', path: 'a.ts' }).preview).toBe('f:b.ts');
  });

  it(`keeps at most ${MAX_TABS} tabs, closing the oldest`, () => {
    let location = parse('');
    for (let index = 0; index <= MAX_TABS; index += 1) {
      location = apply(
        location,
        resolveOpenPatch(location, { kind: 'file', path: `${index}.ts` }, { pin: true })
      );
    }
    expect(location.tabs).toHaveLength(MAX_TABS);
    expect(location.tabs[0]?.path).toBe('1.ts');
  });

  it('closing the open tab moves to its neighbour, and the last one leaves nothing open', () => {
    const location = parse('open=f%3Aa.ts,f%3Ab.ts,f%3Ac.ts&file=b.ts&preview=f%3Ab.ts&line=4');
    expect(resolveClosePatch(location, { kind: 'file', path: 'b.ts' })).toEqual({
      open: 'f:a.ts,f:c.ts',
      preview: null,
      file: 'c.ts',
      diff: null,
      line: null,
      end: null,
      spot: null,
    });
    expect(resolveClosePatch(location, { kind: 'file', path: 'a.ts' })).toEqual({
      open: 'f:b.ts,f:c.ts',
      preview: 'f:b.ts',
    });
    const alone = parse('file=a.ts&diff=1');
    expect(resolveClosePatch(alone, { kind: 'diff', path: 'a.ts' })).toMatchObject({
      open: null,
      file: null,
    });
  });
});

describe('patches', () => {
  it('leave the default mode out of the URL and write the search', () => {
    expect(resolveModePatch('review', [...MODES])).toEqual({ mode: null });
    expect(resolveModePatch('files', [...MODES])).toEqual({ mode: 'files' });
    expect(resolveSearchPatch({ query: 'x', regex: true, caseSensitive: false, glob: ' ' })).toEqual({
      mode: 'search',
      q: 'x',
      regex: '1',
      case: null,
      glob: null,
    });
    expect(resolveSearchPatch({ query: '', regex: false, caseSensitive: true, glob: '*.md' })).toMatchObject({
      q: null,
      case: '1',
      glob: '*.md',
    });
    expect(Object.values(resolveClearPatch()).every((value) => value === null)).toBe(true);
  });
});
