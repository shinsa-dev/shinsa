import { describe, expect, it } from 'bun:test';
import { rankPaths, scorePath, splitHits } from '@/lib/code/rank.ts';

const PATHS = [
  'apps/web/src/lib/review/spots.ts',
  'apps/web/src/lib/review/spot-keys.ts',
  'apps/web/src/components/code/quick-open.tsx',
  'apps/engine/src/agents/supervisor.ts',
  'packages/core/src/report/markdown.ts',
  'docs/design.md',
];

describe('rankPaths', () => {
  it('keeps the same best matches as ranking every path, in the same order', () => {
    const paths = Array.from(
      { length: 600 },
      (_, index) => `src/${['lib', 'code', 'web'][index % 3]}/file-${index}.ts`
    );
    const query = 'file-1';
    const everything = paths
      .flatMap((path) => scorePath(path, query) ?? [])
      .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    expect(rankPaths(paths, query, 20)).toEqual(everything.slice(0, 20));
    expect(rankPaths(paths, 'FILE-1', 20)).toEqual(everything.slice(0, 20));
  });

  it('puts a file whose name contains the query first, its name start before the middle', () => {
    expect(rankPaths(PATHS, 'spots', 3).map((entry) => entry.path)).toEqual([
      'apps/web/src/lib/review/spots.ts',
      'apps/web/src/lib/review/spot-keys.ts',
      'apps/engine/src/agents/supervisor.ts',
    ]);
  });

  it('opens a file in a few keystrokes from the starts of its words', () => {
    expect(rankPaths(PATHS, 'qo', 1)[0]?.path).toBe('apps/web/src/components/code/quick-open.tsx');
    expect(rankPaths(PATHS, 'des', 1)[0]?.path).toBe('docs/design.md');
  });

  it('matches across folders when the name alone does not, and drops what does not match', () => {
    expect(rankPaths(PATHS, 'core mark', 5).map((entry) => entry.path)).toEqual([
      'packages/core/src/report/markdown.ts',
    ]);
    expect(rankPaths(PATHS, 'zzz', 5)).toEqual([]);
    expect(rankPaths(PATHS, 'web/src', 1)[0]?.hits).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });

  it('with no query lists the open files first, then the rest, up to the limit', () => {
    expect(rankPaths(PATHS, ' ', 3, ['docs/design.md', 'gone.ts']).map((entry) => entry.path)).toEqual([
      'docs/design.md',
      'apps/web/src/lib/review/spots.ts',
      'apps/web/src/lib/review/spot-keys.ts',
    ]);
  });
});

describe('scorePath', () => {
  it('rewards consecutive letters and word starts over scattered ones', () => {
    const tight = scorePath('src/supervisor.ts', 'super')?.score ?? 0;
    const loose = scorePath('src/s-u-p-e-r.ts', 'super')?.score ?? 0;
    expect(tight).toBeGreaterThan(loose);
    expect(scorePath('src/QuickOpen.tsx', 'qo')?.hits).toEqual([4, 9]);
    expect(scorePath('a.ts', '')).toEqual({ path: 'a.ts', score: 0, hits: [] });
  });
});

describe('splitHits', () => {
  it('splits text into matched and plain runs, offset into the path', () => {
    expect(splitHits('spots.ts', [10, 11, 12], 10)).toEqual([
      { text: 'spo', hit: true },
      { text: 'ts.ts', hit: false },
    ]);
  });
});
