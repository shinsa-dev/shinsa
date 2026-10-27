import { describe, expect, test } from 'bun:test';
import {
  type CoverageInput,
  measureCoverage,
  resolveCoverageRanges,
  resolveReportPath,
} from '../../src/test-coverage/measure.ts';
import { COVERAGE_LIMITS } from '../../src/test-coverage/types.ts';

function hits(entries: Record<string, Record<number, number>>) {
  return new Map(
    Object.entries(entries).map(([path, lines]) => [
      path,
      new Map(Object.entries(lines).map(([line, count]) => [Number(line), count])),
    ])
  );
}

function input(overrides: Partial<CoverageInput>): CoverageInput {
  return {
    command: 'bun test --coverage',
    changed: new Map(),
    hits: new Map(),
    roots: ['/repo'],
    modulePath: null,
    ...overrides,
  };
}

describe('report paths', () => {
  test('absolute paths under the checkout, its real path or a Go module become repository-relative', () => {
    expect(resolveReportPath('/repo/src/a.ts', ['/repo/'], null)).toBe('src/a.ts');
    expect(resolveReportPath('/private/repo/./src/../src/a.ts', ['/repo', '/private/repo'], null)).toBe(
      'src/a.ts'
    );
    expect(resolveReportPath('C:\\repo\\src\\a.ts', ['C:\\repo'], null)).toBe('src/a.ts');
    expect(resolveReportPath('example.com/app/pkg/a.go', ['/repo'], 'example.com/app')).toBe('pkg/a.go');
    expect(resolveReportPath('other.com/x/a.go', ['/repo'], 'example.com/app')).toBe('other.com/x/a.go');
    expect(resolveReportPath('./src/a.ts', ['/', ''], null)).toBe('src/a.ts');
    expect(resolveReportPath('../../up.ts', ['/repo'], null)).toBe('../../up.ts');
    expect(resolveReportPath('/elsewhere/a.ts', ['/repo'], null)).toBe('/elsewhere/a.ts');
  });
});

describe('ranges', () => {
  test('merges consecutive lines and drops repeats, in order', () => {
    expect(resolveCoverageRanges([7, 3, 4, 5, 9, 4, 10])).toEqual([
      [3, 5],
      [7, 7],
      [9, 10],
    ]);
    expect(resolveCoverageRanges([])).toEqual([]);
  });
});

describe('measuring', () => {
  test('counts the changed lines the report lists, per file, most missed first, totals over all of them', () => {
    const coverage = measureCoverage(
      input({
        changed: new Map([
          ['src/a.ts', [1, 2, 3, 4, 5, 2]],
          ['src/b.ts', [10, 11]],
          ['README.md', [1, 2]],
          ['src/types.ts', [1]],
          ['src/z.ts', [1]],
        ]),
        hits: hits({
          '/repo/src/a.ts': { 1: 1, 2: 0, 3: 0, 5: 0, 9: 0 },
          'src/b.ts': { 10: 3, 11: 1 },
          'src/types.ts': { 4: 0 },
          'src/z.ts': { 1: 0 },
        }),
      })
    );
    expect(coverage).toEqual({
      status: 'measured',
      command: 'bun test --coverage',
      covered: 3,
      executable: 7,
      files: [
        {
          path: 'src/a.ts',
          covered: 1,
          executable: 4,
          uncovered: [
            [2, 3],
            [5, 5],
          ],
        },
        { path: 'src/z.ts', covered: 0, executable: 1, uncovered: [[1, 1]] },
        { path: 'src/b.ts', covered: 2, executable: 2, uncovered: [] },
      ],
    });
  });

  test('a report path that only ends with the changed path matches its closest candidate', () => {
    const coverage = measureCoverage(
      input({
        roots: ['/checkout'],
        changed: new Map([['pkg/m.py', [1, 2]]]),
        hits: hits({
          '/ci/build/app/vendor/pkg/m.py': { 1: 0, 2: 0 },
          '/ci/app/pkg/m.py': { 1: 1, 2: 0 },
          '/ci/app/pkg/m.pyc': { 1: 1 },
        }),
      })
    );
    expect(coverage.files).toEqual([{ path: 'pkg/m.py', covered: 1, executable: 2, uncovered: [[2, 2]] }]);
  });

  test('two report entries that resolve to one file add up', () => {
    const coverage = measureCoverage(
      input({
        roots: ['/repo', '/private/repo'],
        changed: new Map([['a.ts', [1, 2]]]),
        hits: hits({ '/repo/a.ts': { 1: 0, 2: 0 }, '/private/repo/a.ts': { 2: 1, 3: 1 } }),
      })
    );
    expect(coverage).toMatchObject({ covered: 1, executable: 2 });
  });

  test('no changed line the report lists means nothing executable', () => {
    expect(measureCoverage(input({ changed: new Map([['a.ts', [1]]]) }))).toEqual({
      status: 'measured',
      command: 'bun test --coverage',
      covered: 0,
      executable: 0,
      files: [],
    });
  });

  test('keeps at most the file and range limits, while the totals count every file', () => {
    const files = Array.from({ length: COVERAGE_LIMITS.files + 5 }, (_, index) => `f${index}.ts`);
    const lines = Array.from({ length: COVERAGE_LIMITS.ranges + 5 }, (_, index) => index * 2 + 1);
    const coverage = measureCoverage(
      input({
        changed: new Map(files.map((file) => [file, lines])),
        hits: hits(
          Object.fromEntries(files.map((file) => [file, Object.fromEntries(lines.map((line) => [line, 0]))]))
        ),
      })
    );
    expect(coverage.files).toHaveLength(COVERAGE_LIMITS.files);
    expect(coverage.files[0]?.uncovered).toHaveLength(COVERAGE_LIMITS.ranges);
    expect(coverage.executable).toBe(files.length * lines.length);
  });
});
