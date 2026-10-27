import { describe, expect, test } from 'bun:test';
import {
  describeCoverage,
  describeCoverageRange,
  formatCoveragePercent,
  listCoverageGaps,
  selectMeasuredCoverage,
} from '../../src/test-coverage/describe.ts';
import { COVERAGE_LIMITS, type Coverage, type CoverageFile } from '../../src/test-coverage/types.ts';

function measured(covered: number, executable: number, files: CoverageFile[] = []): Coverage {
  return { status: 'measured', command: 'bun test --coverage', covered, executable, files };
}

describe('the coverage summary', () => {
  test('says how many changed lines are covered, with numbers that agree with their nouns', () => {
    expect(describeCoverage(measured(42, 42))).toBe('All 42 changed lines are covered');
    expect(describeCoverage(measured(1, 1))).toBe('The changed line is covered');
    expect(describeCoverage(measured(0, 1))).toBe('The changed line is not covered');
    expect(describeCoverage(measured(0, 12))).toBe('None of the 12 changed lines are covered');
    expect(describeCoverage(measured(36, 42))).toBe('85% of changed lines are covered (36 of 42)');
  });

  test('says nothing when coverage is missing, unavailable or nothing changed is executable', () => {
    expect(describeCoverage(null)).toBeNull();
    expect(describeCoverage(undefined)).toBeNull();
    expect(describeCoverage({ status: 'unavailable', command: 'x', reason: 'no report' })).toBeNull();
    expect(describeCoverage(measured(0, 0))).toBeNull();
    expect(selectMeasuredCoverage(measured(1, 2))).toMatchObject({ covered: 1 });
  });

  test('a percentage never rounds to 0% or 100% unless it is exactly that', () => {
    expect(formatCoveragePercent(1, 1000)).toBe('1%');
    expect(formatCoveragePercent(999, 1000)).toBe('99%');
    expect(formatCoveragePercent(0, 5)).toBe('0%');
    expect(formatCoveragePercent(5, 5)).toBe('100%');
  });
});

describe('the gaps for the reviewer', () => {
  test('lists the files with uncovered changed lines and their ranges, capped', () => {
    const many = Array.from({ length: COVERAGE_LIMITS.reviewRanges + 2 }, (_, index): [number, number] => [
      index * 10,
      index * 10 + 1,
    ]);
    const files: CoverageFile[] = [
      {
        path: 'src/a.ts',
        covered: 3,
        executable: 6,
        uncovered: [
          [4, 4],
          [8, 9],
        ],
      },
      { path: 'src/b.ts', covered: 0, executable: 30, uncovered: many },
      { path: 'src/c.ts', covered: 2, executable: 2, uncovered: [] },
      ...Array.from({ length: COVERAGE_LIMITS.reviewFiles }, (_, index) => ({
        path: `src/more-${index}.ts`,
        covered: 0,
        executable: 1,
        uncovered: [[1, 1]] as [number, number][],
      })),
    ];
    const gaps = listCoverageGaps(measured(5, 38 + COVERAGE_LIMITS.reviewFiles, files));
    expect(gaps).toHaveLength(COVERAGE_LIMITS.reviewFiles);
    expect(gaps[0]).toBe('src/a.ts: 3 of 6 changed lines covered; not covered: 4, 8-9');
    expect(gaps[1]).toEndWith(', …');
    expect(listCoverageGaps(null)).toEqual([]);
    expect(describeCoverageRange([3, 3])).toBe('3');
  });
});
