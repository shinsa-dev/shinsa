import { describe, expect, it } from 'bun:test';
import type { DiffFile, TaskDiff } from '@shinsa/core';
import { resolveFallbackReport } from '@/lib/review/fallback-report.ts';

function hunk(start: number, count?: number) {
  const span = count === undefined ? `${start}` : `${start},${count}`;
  return `@@ -${start},1 +${span} @@\n-old\n+new\n`;
}

function createFile(path: string, overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    risk: 'normal',
    riskReason: null,
    patch: hunk(10, 3),
    ...overrides,
  };
}

function createDiff(files: DiffFile[]): TaskDiff {
  return { base: 'main', files };
}

describe('resolveFallbackReport', () => {
  it('walks through risky files first, then the main change, then tests and docs', () => {
    const report = resolveFallbackReport(
      createDiff([
        createFile('docs/guide.md', { risk: 'low' }),
        createFile('src/app.ts'),
        createFile('src/auth.ts', { risk: 'high', riskReason: 'Touches sign-in.' }),
      ]),
      'Adds retries to exports'
    );
    expect(report.headline).toBe('Adds retries to exports');
    expect(report.checks).toEqual([]);
    expect(report.decisions).toEqual([]);
    expect(report.phases.map((phase) => [phase.title, phase.spots.map((spot) => spot.file)])).toEqual([
      ['Look closely', ['src/auth.ts']],
      ['The main change', ['src/app.ts']],
      ['Tests and docs', ['docs/guide.md']],
    ]);
  });

  it('ranks spots by the risk of their file and says why they matter', () => {
    const report = resolveFallbackReport(
      createDiff([
        createFile('src/auth.ts', { risk: 'high', riskReason: 'Touches sign-in.' }),
        createFile('src/new.ts', { status: 'added', patch: '@@ -0,0 +1,4 @@\n+a\n+b\n+c\n+d\n' }),
        createFile('test/app.test.ts', { risk: 'low' }),
      ]),
      ''
    );
    expect(report.phases.flatMap((phase) => phase.spots)).toEqual([
      { file: 'src/auth.ts', start: 10, end: 12, attention: 'critical', why: 'Touches sign-in.' },
      { file: 'src/new.ts', start: 1, end: 4, attention: 'high', why: 'New file.' },
      { file: 'test/app.test.ts', start: 10, end: 12, attention: 'normal', why: 'Changed lines.' },
    ]);
  });

  it('points a hunk without a count, or one that only removes lines, at a single line', () => {
    const report = resolveFallbackReport(
      createDiff([
        createFile('a.ts', { patch: hunk(7) }),
        createFile('b.ts', { patch: '@@ -5,2 +4,0 @@\n-x\n-y\n' }),
        createFile('c.ts', { status: 'removed', patch: '@@ -1,2 +0,0 @@\n-x\n-y\n' }),
      ]),
      ''
    );
    expect(report.phases[0]?.spots.map((spot) => [spot.file, spot.start, spot.end])).toEqual([
      ['a.ts', 7, 7],
      ['b.ts', 4, 4],
      ['c.ts', 1, 1],
    ]);
  });

  it('takes at most three spots from a file and six from a phase', () => {
    const patch = [hunk(1, 1), hunk(20, 1), hunk(40, 1), hunk(60, 1)].join('');
    const report = resolveFallbackReport(
      createDiff([
        createFile('a.ts', { patch }),
        createFile('b.ts', { patch }),
        createFile('c.ts', { patch }),
      ]),
      ''
    );
    const spots = report.phases[0]?.spots ?? [];
    expect(spots).toHaveLength(6);
    expect(spots.map((spot) => `${spot.file}:${spot.start}`)).toEqual([
      'a.ts:1',
      'a.ts:20',
      'a.ts:40',
      'b.ts:1',
      'b.ts:20',
      'b.ts:40',
    ]);
  });

  it('starts the main change with the files that touch the most lines', () => {
    const report = resolveFallbackReport(
      createDiff([
        createFile('small.ts', { additions: 2, deletions: 1 }),
        createFile('large.ts', { additions: 80, deletions: 40 }),
        createFile('medium.ts', { additions: 20, deletions: 5 }),
      ]),
      ''
    );
    expect(report.phases[0]?.spots.map((spot) => spot.file)).toEqual(['large.ts', 'medium.ts', 'small.ts']);
  });

  it('leaves out files without text changes and phases with nothing to show', () => {
    const report = resolveFallbackReport(
      createDiff([createFile('logo.png', { patch: '' })]),
      'Swaps the logo'
    );
    expect(report).toEqual({ headline: 'Swaps the logo', phases: [], checks: [], decisions: [] });
  });
});
