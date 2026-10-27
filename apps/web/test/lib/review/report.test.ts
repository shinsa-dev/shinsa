import { describe, expect, it } from 'bun:test';
import type { CodeSpot, Coverage, DiffFile, ReviewFinding, WorkReport } from '@shinsa/core';
import {
  describeAgentReview,
  describeItemPlace,
  describePointCount,
  describeStopPosition,
  isFindingItem,
  listOtherFiles,
  listReviewChapters,
  listReviewPoints,
  listReviewStops,
  REVIEW_AUTHOR_ICON,
  resolveNoteHeading,
  resolvePointTitle,
  resolveStopInView,
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
    { title: 'Keep the API', call: 'Kept the API', reason: 'Small change.', file: 'e.ts', line: 3 },
    { title: 'Retry three times', call: 'Three tries', reason: 'Matches the rest.', file: null, line: null },
  ],
};

const WALKTHROUGH = {
  approach: 'Retry at the client.',
  flow: 'call → retry → give up',
  risks: [
    { title: 'Retries a bad request', risk: 'A 400 retries too.', file: 'f.ts', line: 7, end: 9 },
    { title: 'Uncapped wait', risk: 'Nothing caps the wait.', file: null, line: null, end: null },
  ],
  testing: { automated: ['Drop the connection.'], manual: [] },
};

describe('listReviewChapters', () => {
  it('reads how it is built and tested, the key code, the decisions, what to read carefully, then the agent review', () => {
    const chapters = listReviewChapters(
      { ...REPORT, walkthrough: WALKTHROUGH },
      [
        finding({ message: 'Rename.' }),
        finding({
          severity: 'blocking',
          file: 'b.ts',
          line: 11,
          end: 12,
          title: 'Off by one',
          fix: 'Use `<`.',
        }),
      ],
      [{ call: 'Three tries', reason: 'Two is enough.' }]
    );
    expect(
      chapters.map((chapter) => [
        chapter.id,
        chapter.title,
        chapter.prose.map((prose) => prose.title),
        chapter.items.map((item) => item.key),
      ])
    ).toEqual([
      ['built', 'How it’s built', ['Approach', 'How it works', 'How to test'], []],
      ['code', 'Key code', [], ['0:0']],
      ['calls', 'Judgement calls', [], ['call:0', 'call:1']],
      ['careful', 'Read carefully', [], ['0:1', '1:0', '1:1', 'risk:0', 'risk:1']],
      ['review', 'Agent review', [], ['finding:1', 'finding:0']],
    ]);
    const points = listReviewPoints(chapters);
    expect(points.map((item) => item.label)).toEqual([
      'Context',
      'Judgement call',
      'Disputed',
      'Critical',
      'Read carefully',
      'Critical',
      'Risk',
      'Risk',
      'Blocking',
      'Suggestion',
    ]);
    expect(points[2]).toMatchObject({
      title: 'Retry three times',
      lead: 'Three tries',
      disagreement: 'Two is enough.',
      tone: 'orange',
    });
    expect(points[1]).toMatchObject({ place: { file: 'e.ts', start: 3, end: 3 }, disagreement: null });
    expect(points[6]).toMatchObject({
      body: 'A 400 retries too.',
      place: { file: 'f.ts', start: 7, end: 9 },
    });
    expect(points[7]?.place).toBeNull();
    expect(points[8]).toMatchObject({ title: 'Off by one', fix: 'Use `<`.', finding: 1, tone: 'red' });
  });

  it('builds with How to test for the checks alone, and has no such chapter without a walkthrough or checks', () => {
    const checked: WorkReport = { ...REPORT, checks: [{ name: 'Tests', outcome: 'pass', detail: null }] };
    expect(
      listReviewChapters(checked, []).map((chapter) => [chapter.id, chapter.prose.map((prose) => prose.key)])
    ).toEqual([
      ['built', ['testing']],
      ['code', []],
      ['calls', []],
      ['careful', []],
    ]);
    expect(listReviewChapters(REPORT, []).map((chapter) => chapter.id)).toEqual(['code', 'calls', 'careful']);
  });

  it('builds with How to test for measured coverage alone, but not for coverage that could not be measured', () => {
    const built = (coverage: Coverage) => listReviewChapters(REPORT, [], [], [], coverage)[0];
    expect(built(createPartialCoverage())?.prose.map((prose) => prose.key)).toEqual(['testing']);
    expect(built({ status: 'unavailable', command: 'bun test', reason: 'No report.' })?.id).toBe('code');
  });

  it('builds with How to test for steps to try alone, and leaves it out when the walkthrough has nothing to test', () => {
    const step = { action: 'Open the orders page.', target: null, expect: 'The order shows as paid.' };
    const prose = (testing: NonNullable<WorkReport['walkthrough']>['testing']) =>
      listReviewChapters({ ...REPORT, walkthrough: { ...WALKTHROUGH, testing } }, [])[0]?.prose.map(
        (item) => item.key
      );
    expect(prose({ automated: [], manual: [step] })).toEqual(['approach', 'flow', 'testing']);
    expect(prose({ automated: [], manual: [] })).toEqual(['approach', 'flow']);
  });

  it('puts the steps around the merge after How to test, each list only when it has a step', () => {
    const step = { kind: 'env' as const, title: 'Set A', detail: 'In production.', command: null };
    const steps = [
      { ...step, when: 'post_merge' as const },
      { ...step, when: 'pre_merge' as const },
    ];
    const built = listReviewChapters({ ...REPORT, walkthrough: { ...WALKTHROUGH, steps } }, [])[0];
    expect(built?.prose.map((prose) => [prose.key, prose.title, prose.icon])).toEqual([
      ['approach', 'Approach', 'IconLightbulbGlow'],
      ['flow', 'How it works', 'IconLayersThree'],
      ['testing', 'How to test', 'IconTestTube'],
      ['pre_merge', 'Pre-merge steps', 'IconChecklist'],
      ['post_merge', 'Post-merge steps', 'IconMerged'],
    ]);
    expect(
      listReviewChapters(REPORT, [], [], [steps[0] as (typeof steps)[number]])[0]?.prose.map(
        (prose) => prose.key
      )
    ).toEqual(['post_merge']);
  });

  it('shows a key piece of code by its title and explanation, with why it matters under them', () => {
    const report: WorkReport = {
      ...REPORT,
      sections: [
        {
          title: 'Set up',
          summary: 'S',
          spots: [{ ...createSpot('a.ts', 'high', 4, 2), title: 'The client', explain: 'Wraps fetch.' }],
        },
      ],
      judgementCalls: [
        {
          title: 'Keep the API',
          call: 'Kept the API',
          reason: 'Small.',
          file: 'e.ts',
          line: 3,
          end: 6,
          alternatives: [{ option: 'A new API', rejected: 'Breaks callers.' }],
        },
      ],
    };
    const [call, spot] = listReviewPoints(listReviewChapters(report, []));
    expect(spot).toMatchObject({
      title: 'The client',
      body: 'Wraps fetch.',
      why: 'Why a.ts',
      place: { file: 'a.ts', start: 4, end: 4 },
      section: 'Set up',
    });
    expect(call).toMatchObject({
      title: 'Keep the API',
      lead: 'Kept the API',
      body: 'Small.',
      place: { file: 'e.ts', start: 3, end: 6 },
      alternatives: [{ option: 'A new API', rejected: 'Breaks callers.' }],
    });
  });

  it('lists only the findings without a report, blocking first', () => {
    expect(
      listReviewPoints(
        listReviewChapters(null, [finding({}), finding({ severity: 'blocking', file: null, line: null })])
      ).map((item) => [item.key, item.place])
    ).toEqual([
      ['finding:1', null],
      ['finding:0', { file: 'a.ts', start: 4, end: 4 }],
    ]);
    expect(listReviewChapters(null, [])).toEqual([]);
  });

  it('matches each disagreement to one call, even when two calls read the same', () => {
    const report = {
      ...REPORT,
      judgementCalls: [
        { title: 'Same', call: 'Same', reason: 'A.', file: null, line: null },
        { title: 'Same', call: 'Same', reason: 'B.', file: null, line: null },
      ],
    };
    const points = listReviewPoints(listReviewChapters(report, [], [{ call: 'Same', reason: 'No.' }]));
    expect(points.filter((item) => item.key.startsWith('call:')).map((item) => item.disagreement)).toEqual([
      'No.',
      null,
    ]);
  });
});

describe('resolvePointTitle', () => {
  it('uses the title, else the first sentence of the body', () => {
    const [first, second] = listReviewPoints(listReviewChapters({ ...REPORT, judgementCalls: [] }, []));
    expect(first && resolvePointTitle(first)).toBe('Why a.ts');
    expect(second && resolvePointTitle({ ...second, title: 'Named' })).toBe('Named');
    expect(second && resolvePointTitle({ ...second, body: 'One thing. Then another.' })).toBe('One thing.');
    expect(
      second &&
        resolvePointTitle({ ...second, title: 'Keys `a:b` in **[spots.ts](shinsa://file/spots.ts)**' })
    ).toBe('Keys a:b in spots.ts');
  });
});

describe('stepReviewItem', () => {
  const items = listReviewPoints(listReviewChapters(REPORT, []));

  it('steps forward and back and stops at both ends', () => {
    expect(stepReviewItem(items, 'call:1', 1)?.key).toBe('0:1');
    expect(stepReviewItem(items, '0:1', -1)?.key).toBe('call:1');
    expect(stepReviewItem(items, '0:0', -1)?.key).toBe('0:0');
    expect(stepReviewItem(items, '1:1', 1)?.key).toBe('1:1');
  });

  it('starts at the first going forward and the last going back', () => {
    expect(stepReviewItem(items, null, 1)?.key).toBe('0:0');
    expect(stepReviewItem(items, 'gone', -1)?.key).toBe('1:1');
    expect(stepReviewItem([], null, 1)).toBeNull();
  });
});

describe('the stops of the index', () => {
  const stops = listReviewStops(listReviewChapters({ ...REPORT, walkthrough: WALKTHROUGH }, [finding({})]));

  it('lists the walkthrough unnumbered and numbers every point in reading order, each with its chapter', () => {
    expect(stops.map((stop) => [stop.key, stop.chapterTitle, stop.number, stop.title])).toEqual([
      ['approach', 'How it’s built', null, 'Approach'],
      ['flow', 'How it’s built', null, 'How it works'],
      ['testing', 'How it’s built', null, 'How to test'],
      ['0:0', 'Key code', 1, 'Why a.ts'],
      ['call:0', 'Judgement calls', 2, 'Keep the API'],
      ['call:1', 'Judgement calls', 3, 'Retry three times'],
      ['0:1', 'Read carefully', 4, 'Why b.ts'],
      ['1:0', 'Read carefully', 5, 'Why c.ts'],
      ['1:1', 'Read carefully', 6, 'Why d.ts'],
      ['risk:0', 'Read carefully', 7, 'Retries a bad request'],
      ['risk:1', 'Read carefully', 8, 'Uncapped wait'],
      ['finding:0', 'Agent review', 9, 'Consider a guard.'],
    ]);
    expect(stops[4]?.item?.key).toBe('call:0');
    expect(stops[0]?.item).toBeNull();
    expect(stops.map((stop) => stop.icon).filter(Boolean)).toEqual([
      'IconLightbulbGlow',
      'IconLayersThree',
      'IconTestTube',
    ]);
  });

  it('says where a point sits among the points, and nothing for the walkthrough', () => {
    expect(stops[4] && describeStopPosition(stops[4], 9)).toBe('2 of 9');
    expect(stops[0] && describeStopPosition(stops[0], 9)).toBeNull();
  });

  it('finds the stop you are reading: the last one the line passed, or the last in view at the end', () => {
    const marks = [
      { key: 'a', top: -400 },
      { key: 'b', top: 30 },
      { key: 'c', top: 300 },
      { key: 'd', top: 700 },
    ];
    expect(resolveStopInView(marks, 40, null)).toBe('b');
    expect(resolveStopInView(marks, 40, 800)).toBe('d');
    expect(resolveStopInView([{ key: 'a', top: 200 }], 40, null)).toBeNull();
  });
});

describe('listOtherFiles', () => {
  it('keeps the changed files no spot, finding, judgement call or risk points at', () => {
    const files = ['a.ts', 'e.ts', 'f.ts', 'q.ts', 'z.ts'].map(changedFile);
    const report = { ...REPORT, walkthrough: WALKTHROUGH };
    expect(listOtherFiles(files, report, [finding({ file: 'z.ts' })]).map((item) => item.path)).toEqual([
      'q.ts',
    ]);
    expect(listOtherFiles(files, REPORT, []).map((item) => item.path)).toEqual(['f.ts', 'q.ts', 'z.ts']);
    expect(listOtherFiles(files, null, []).map((item) => item.path)).toEqual([
      'a.ts',
      'e.ts',
      'f.ts',
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

  it('counts the points and names the ones that matter most', () => {
    expect(describePointCount([])).toBe('No point is marked. The changed files are under Everything else.');
    expect(describePointCount(listReviewPoints(listReviewChapters(null, [finding({})])))).toBe(
      '1 point to read.'
    );
    expect(
      describePointCount(
        listReviewPoints(
          listReviewChapters(
            REPORT,
            [finding({ severity: 'blocking' })],
            [{ call: 'Kept the API', reason: 'No.' }]
          )
        )
      )
    ).toBe('7 points to read, 1 blocking, 2 critical, 2 judgement calls, 1 disputed by the agent review.');
    expect(
      describePointCount(
        listReviewPoints(
          listReviewChapters({ ...REPORT, sections: [], judgementCalls: [REPORT.judgementCalls[0]!] }, [])
        )
      )
    ).toBe('1 point to read, 1 judgement call.');
  });

  it('names a place by its short path and lines, and every author', () => {
    expect(describeItemPlace({ file: 'src/a.ts', start: 3, end: 3 })).toBe('src/a.ts:3');
    expect(describeItemPlace({ file: 'src/a.ts', start: 3, end: 9 })).toBe('src/a.ts:3–9');
    expect(Object.values(REVIEW_AUTHOR_ICON)).toEqual(['IconEyeSparkle', 'IconAgent', 'IconBubbleText']);
  });
});

describe('the heading of a card', () => {
  it('titles the agent’s points and names the author only for the agent review and your comments', () => {
    const points = listReviewPoints(
      listReviewChapters({ ...REPORT, walkthrough: WALKTHROUGH }, [finding({ title: 'Guard it' })])
    );
    const heading = (key: string) => {
      const item = points.find((point) => point.key === key);
      return item && resolveNoteHeading(item);
    };
    expect(heading('call:0')).toEqual({ author: null, title: 'Keep the API' });
    expect(heading('risk:1')).toEqual({ author: null, title: 'Uncapped wait' });
    expect(heading('0:0')).toEqual({ author: null, title: 'Why a.ts' });
    expect(heading('finding:0')).toEqual({ author: 'Agent review', title: null });
    expect(
      resolveNoteHeading(
        toCommentItem({ id: 'c', path: 'a.ts', side: 'new', line: 1, endLine: null, ref: null, text: 'Hm.' })
      )
    ).toEqual({ author: 'You', title: null });
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

  it('tells a finding from the points and comments, which carry a header bar', () => {
    expect(isFindingItem(toFindingItem(finding({}), 0))).toBe(true);
    expect(
      isFindingItem(
        toCommentItem({ id: 'c', path: 'a.ts', side: 'new', line: 1, endLine: null, ref: null, text: 'Hm.' })
      )
    ).toBe(false);
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
