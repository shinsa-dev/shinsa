import { describe, expect, it } from 'bun:test';
import type { CodeSpot, ReviewFinding, WorkReport } from '@shinsa/core';
import { listFindingTargets, listReviewTargets } from '@/lib/review/targets.ts';

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
    expect(listReviewTargets(REPORT).map((target) => [target.key, target.file, target.section])).toEqual([
      ['0:0', 'a.ts', 'Set up'],
      ['0:1', 'b.ts', 'Set up'],
      ['1:0', 'c.ts', 'Retry'],
      ['1:1', 'd.ts', 'Retry'],
    ]);
  });

  it('marks judgement calls and risks with lines, under the keys the Review tab links with', () => {
    const report: WorkReport = {
      ...REPORT,
      sections: [],
      judgementCalls: [
        { title: 'Keep the API', call: 'Kept the API', reason: 'Small.', file: 'e.ts', line: 3, end: 5 },
        { title: 'Retry three times', call: 'Three tries', reason: 'Enough.', file: null, line: null },
      ],
      walkthrough: {
        approach: 'A',
        flow: 'B',
        risks: [
          { title: 'Retries a bad request', risk: 'A 400 retries too.', file: 'f.ts', line: 7, end: null },
          { title: 'Uncapped wait', risk: 'Nothing caps it.', file: 'g.ts', line: null, end: null },
        ],
        testing: { automated: [], manual: [] },
      },
    };
    expect(listReviewTargets(report)).toEqual([
      {
        key: 'call:0',
        file: 'e.ts',
        start: 3,
        end: 5,
        attention: 'normal',
        why: 'Kept the API',
        section: 'Judgement calls',
      },
      {
        key: 'risk:0',
        file: 'f.ts',
        start: 7,
        end: 7,
        attention: 'high',
        why: 'A 400 retries too.',
        section: 'Risks and edge cases',
      },
    ]);
  });

  it('has nothing to step through in an empty report', () => {
    const empty = { ...REPORT, sections: [] };
    expect(listReviewTargets(empty)).toEqual([]);
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
