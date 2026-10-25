import { describe, expect, it } from 'bun:test';
import type { CodeSpot, DiffFile, ReviewFinding, WorkReport } from '@shinsa/core';
import {
  describeAgentReview,
  describeAttentionCount,
  describeItemPlace,
  listAttentionItems,
  listOtherFiles,
  listReviewSections,
  REVIEW_AUTHOR,
  stepReviewItem,
  toCommentItem,
  toFindingItem,
} from '@/lib/review/report.ts';

function createSpot(file: string, attention: CodeSpot['attention'], start = 1, end = start): CodeSpot {
  return { file, start, end, attention, why: `Why ${file}` };
}

function finding(overrides: Partial<ReviewFinding>): ReviewFinding {
  return { severity: 'suggestion', file: 'a.ts', line: 4, message: 'Consider a guard.', ...overrides };
}

function changedFile(path: string): DiffFile {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions: 1,
    deletions: 0,
    risk: 'normal',
    riskReason: null,
    binary: false,
    patch: '',
  };
}

const REPORT: WorkReport = {
  headline: 'Adds retries',
  sections: [
    {
      title: 'Set up',
      summary: 'S',
      spots: [createSpot('a.ts', 'normal'), createSpot('b.ts', 'critical', 10, 12)],
    },
    { title: 'Retry', summary: 'R', spots: [createSpot('c.ts', 'high'), createSpot('d.ts', 'critical')] },
  ],
  checks: [],
  judgementCalls: [
    { call: 'Kept the API', reason: 'Small change.', file: 'e.ts', line: 3 },
    { call: 'Three tries', reason: 'Matches the rest.', file: null, line: null },
  ],
};

describe('listAttentionItems', () => {
  it('puts blocking findings first, then critical and high spots, then suggestions and judgement calls', () => {
    const items = listAttentionItems(REPORT, [
      finding({ message: 'Rename.' }),
      finding({ severity: 'blocking', file: 'z.ts', line: 2, end: 5, title: 'Off by one', fix: 'Use `<`.' }),
    ]);
    expect(items.map((item) => [item.key, item.label, item.author])).toEqual([
      ['finding:1', 'Blocking', 'review'],
      ['0:1', 'Critical', 'agent'],
      ['1:1', 'Critical', 'agent'],
      ['1:0', 'Read carefully', 'agent'],
      ['finding:0', 'Suggestion', 'review'],
      ['call:0', 'Judgement call', 'agent'],
      ['call:1', 'Judgement call', 'agent'],
    ]);
    expect(items[0]).toMatchObject({
      title: 'Off by one',
      fix: 'Use `<`.',
      place: { file: 'z.ts', start: 2, end: 5 },
      finding: 1,
      tone: 'red',
    });
    expect(items[5]?.place).toEqual({ file: 'e.ts', start: 3, end: 3 });
    expect(items[6]?.place).toBeNull();
  });

  it('folds a spot into the finding on the same lines instead of showing it twice', () => {
    const items = listAttentionItems(REPORT, [finding({ severity: 'blocking', file: 'b.ts', line: 11 })]);
    expect(items.map((item) => item.key)).toEqual(['finding:0', '1:1', '1:0', 'call:0', 'call:1']);
    expect(items[0]?.related.map((item) => item.key)).toEqual(['0:1']);
  });

  it('lists only the findings without a report', () => {
    expect(
      listAttentionItems(null, [finding({}), finding({ severity: 'blocking', file: null, line: null })]).map(
        (item) => [item.key, item.place]
      )
    ).toEqual([
      ['finding:1', null],
      ['finding:0', { file: 'a.ts', start: 4, end: 4 }],
    ]);
  });
});

describe('listReviewSections', () => {
  it('keeps every spot of each section, keyed like the Code tab', () => {
    expect(
      listReviewSections(REPORT).map((section) => [section.title, section.spots.map((item) => item.key)])
    ).toEqual([
      ['Set up', ['0:0', '0:1']],
      ['Retry', ['1:0', '1:1']],
    ]);
    expect(listReviewSections(REPORT)[0]?.spots[0]).toMatchObject({ label: 'Context', tone: 'neutral' });
  });
});

describe('stepReviewItem', () => {
  const items = listAttentionItems(REPORT, []);

  it('steps forward and back and stops at both ends', () => {
    expect(stepReviewItem(items, '0:1', 1)?.key).toBe('1:1');
    expect(stepReviewItem(items, '1:1', -1)?.key).toBe('0:1');
    expect(stepReviewItem(items, '0:1', -1)?.key).toBe('0:1');
    expect(stepReviewItem(items, 'call:1', 1)?.key).toBe('call:1');
  });

  it('starts at the first going forward and the last going back', () => {
    expect(stepReviewItem(items, null, 1)?.key).toBe('0:1');
    expect(stepReviewItem(items, 'gone', -1)?.key).toBe('call:1');
    expect(stepReviewItem([], null, 1)).toBeNull();
  });
});

describe('listOtherFiles', () => {
  it('keeps the changed files no spot, finding or judgement call points at', () => {
    const files = ['a.ts', 'e.ts', 'q.ts', 'z.ts'].map(changedFile);
    expect(listOtherFiles(files, REPORT, [finding({ file: 'z.ts' })]).map((item) => item.path)).toEqual([
      'q.ts',
    ]);
    expect(listOtherFiles(files, null, []).map((item) => item.path)).toEqual([
      'a.ts',
      'e.ts',
      'q.ts',
      'z.ts',
    ]);
  });
});

describe('describing the review', () => {
  it('counts what the agent review found', () => {
    expect(describeAgentReview([])).toBe('Found nothing to fix.');
    expect(describeAgentReview([finding({ severity: 'blocking' })])).toBe('Found 1 blocking finding.');
    expect(describeAgentReview([finding({}), finding({}), finding({ severity: 'blocking' })])).toBe(
      'Found 1 blocking finding and 2 suggestions.'
    );
  });

  it('says how many places need you', () => {
    expect(describeAttentionCount([])).toBe('Nothing stands out. Read the walkthrough below.');
    expect(describeAttentionCount(listAttentionItems(null, [finding({})]))).toBe(
      '1 place needs your attention, the most critical first.'
    );
    expect(describeAttentionCount(listAttentionItems(REPORT, []))).toBe(
      '5 places need your attention, the most critical first.'
    );
  });

  it('names a place by its short path and lines, and every author', () => {
    expect(describeItemPlace({ file: 'src/a.ts', start: 3, end: 3 })).toBe('src/a.ts:3');
    expect(describeItemPlace({ file: 'src/a.ts', start: 3, end: 9 })).toBe('src/a.ts:3–9');
    expect(Object.values(REVIEW_AUTHOR).map((author) => author.label)).toEqual([
      'Agent review',
      'Agent',
      'You',
    ]);
  });
});

describe('items from findings and comments', () => {
  it('reads a finding without a place, title or fix', () => {
    expect(toFindingItem(finding({ file: null, line: null }), 2)).toMatchObject({
      key: 'finding:2',
      title: null,
      fix: null,
      place: null,
    });
  });

  it('turns your comment into an item at its lines, and a removed-line comment into one without a place', () => {
    const comment = {
      id: 'c1',
      path: 'src/a.ts',
      side: 'new' as const,
      line: 4,
      endLine: 6,
      ref: null,
      text: 'Name this.',
    };
    expect(toCommentItem(comment)).toMatchObject({
      key: 'comment:c1',
      author: 'you',
      label: 'Lines 4–6',
      body: 'Name this.',
      place: { file: 'src/a.ts', start: 4, end: 6 },
      section: null,
    });
    expect(toCommentItem({ ...comment, side: 'old', endLine: null })).toMatchObject({
      label: 'Removed line 4',
      place: null,
      section: 'src/a.ts',
    });
    expect(toCommentItem({ ...comment, endLine: null }).place).toEqual({
      file: 'src/a.ts',
      start: 4,
      end: 4,
    });
  });
});
