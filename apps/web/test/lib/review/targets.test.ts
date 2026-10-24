import { describe, expect, it } from 'bun:test';
import type { CodeSpot, ReviewFinding, WorkReport } from '@shinsa/core';
import {
  formatTargetLines,
  listFindingTargets,
  listReviewTargets,
  type ReviewTarget,
  stepTarget,
  toReviewTarget,
} from '@/lib/review/targets.ts';

function spot(file: string, attention: CodeSpot['attention'], start = 1, end = start): CodeSpot {
  return { file, start, end, attention, why: `Why ${file}` };
}

const REPORT: WorkReport = {
  headline: 'Adds retries',
  sections: [
    { title: 'Set up', summary: '', spots: [spot('a.ts', 'normal'), spot('b.ts', 'critical')] },
    { title: 'Retry', summary: '', spots: [spot('c.ts', 'high'), spot('d.ts', 'critical')] },
  ],
  checks: [],
  judgementCalls: [],
};

function finding(overrides: Partial<ReviewFinding>): ReviewFinding {
  return { severity: 'suggestion', file: 'a.ts', line: 4, message: 'Consider a guard.', ...overrides };
}

describe('listReviewTargets', () => {
  it('follows the report section by section in the walkthrough', () => {
    expect(
      listReviewTargets(REPORT, 'walkthrough').map((target) => [target.key, target.file, target.section])
    ).toEqual([
      ['0:0', 'a.ts', 'Set up'],
      ['0:1', 'b.ts', 'Set up'],
      ['1:0', 'c.ts', 'Retry'],
      ['1:1', 'd.ts', 'Retry'],
    ]);
  });

  it('puts critical spots first when ordered by attention, keeping each spot’s key', () => {
    expect(listReviewTargets(REPORT, 'attention').map((target) => [target.key, target.attention])).toEqual([
      ['0:1', 'critical'],
      ['1:1', 'critical'],
      ['1:0', 'high'],
      ['0:0', 'normal'],
    ]);
  });

  it('has nothing to step through in an empty report', () => {
    const empty = { ...REPORT, sections: [] };
    expect(listReviewTargets(empty, 'walkthrough')).toEqual([]);
    expect(listReviewTargets(empty, 'attention')).toEqual([]);
  });
});

describe('toReviewTarget', () => {
  it('carries the spot, its section and its key', () => {
    expect(toReviewTarget(spot('a.ts', 'high', 3, 9), 'Retry', '1:0')).toEqual({
      key: '1:0',
      file: 'a.ts',
      start: 3,
      end: 9,
      attention: 'high',
      why: 'Why a.ts',
      section: 'Retry',
    });
  });
});

describe('listFindingTargets', () => {
  it('turns located agent findings into targets, blocking ones as critical', () => {
    const targets = listFindingTargets([
      finding({ severity: 'blocking', message: 'This drops errors.', end: 8 }),
      finding({ file: null, line: null, message: 'General note.' }),
      finding({ file: 'b.ts', line: null }),
      finding({ file: 'c.ts', line: 2 }),
    ]);
    expect(targets).toEqual([
      {
        key: 'finding:0',
        file: 'a.ts',
        start: 4,
        end: 8,
        attention: 'critical',
        why: 'This drops errors.',
        section: 'Agent review',
      },
      {
        key: 'finding:3',
        file: 'c.ts',
        start: 2,
        end: 2,
        attention: 'high',
        why: 'Consider a guard.',
        section: 'Agent review',
      },
    ]);
  });
});

describe('stepTarget', () => {
  const targets = listReviewTargets(REPORT, 'walkthrough');

  it('steps forward and back', () => {
    expect(stepTarget(targets, 1, 1)?.key).toBe('1:0');
    expect(stepTarget(targets, 1, -1)?.key).toBe('0:0');
  });

  it('wraps around at both ends', () => {
    expect(stepTarget(targets, 3, 1)?.key).toBe('0:0');
    expect(stepTarget(targets, 0, -1)?.key).toBe('1:1');
  });

  it('goes to the first target forward and the last back from a decision target', () => {
    expect(stepTarget(targets, -1, 1)?.key).toBe('0:0');
    expect(stepTarget(targets, -1, -1)?.key).toBe('1:1');
  });

  it('has nowhere to go without targets', () => {
    expect(stepTarget([], 0, 1)).toBeNull();
    expect(stepTarget([], -1, -1)).toBeNull();
  });
});

describe('formatTargetLines', () => {
  it('shows one line or a range', () => {
    const target: ReviewTarget = {
      key: 'k',
      file: 'a.ts',
      start: 7,
      end: 7,
      attention: 'high',
      why: '',
      section: '',
    };
    expect(formatTargetLines(target)).toBe('7');
    expect(formatTargetLines({ ...target, end: 12 })).toBe('7–12');
  });
});
