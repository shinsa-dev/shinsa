import { describe, expect, test } from 'bun:test';
import {
  listRankedSpots,
  type SpecDocument,
  serializeReportMarkdown,
  serializeSpecMarkdown,
  type WorkReport,
} from '../../src/index.ts';

const SPEC: SpecDocument = {
  goal: 'Stop the tabs scrolling.',
  plan: [
    { title: 'Find it', detail: 'Trace the overflow.' },
    { title: 'Fix it', detail: 'Clamp and verify.' },
  ],
  behaviour: ['Tabs stay put.'],
  approach: 'Clamp the width.',
  files: [{ path: 'src/tabs.tsx', change: 'Clamp the width' }],
  outOfScope: ['Mobile'],
  verification: ['Open the page'],
  questions: [
    { question: 'Which width?', options: ['200', '240'], recommendation: null },
    { question: 'Animate it?', options: [], recommendation: null },
  ],
};

describe('serializeSpecMarkdown', () => {
  test('writes every section in reading order', () => {
    expect(serializeSpecMarkdown(SPEC)).toBe(
      [
        '## Goal\nStop the tabs scrolling.',
        '## Plan\n1. **Find it**: Trace the overflow.\n2. **Fix it**: Clamp and verify.',
        '## Behaviour\n- Tabs stay put.',
        '## Approach\nClamp the width.',
        '## Files\n- `src/tabs.tsx`: Clamp the width',
        '## Out of scope\n- Mobile',
        '## Verification\n- Open the page',
        '## Questions\n- Which width? (200 / 240)\n- Animate it?',
      ].join('\n\n')
    );
  });

  test('leaves out empty sections', () => {
    const bare = {
      ...SPEC,
      plan: [],
      behaviour: [],
      files: [],
      outOfScope: [],
      verification: [],
      questions: [],
    };
    expect(serializeSpecMarkdown(bare)).toBe(
      '## Goal\nStop the tabs scrolling.\n\n## Approach\nClamp the width.'
    );
  });
});

const REPORT: WorkReport = {
  headline: 'Clamp the tab width',
  phases: [
    {
      title: 'Find it',
      summary: 'Traced it.',
      spots: [
        { file: 'a.ts', start: 1, end: 2, attention: 'normal', why: 'Context.' },
        { file: 'd.ts', start: 1, end: 2, attention: 'high', why: 'Read it.' },
      ],
    },
    {
      title: 'Fix it',
      summary: 'Clamped it.',
      spots: [
        { file: 'b.ts', start: 1, end: 1, attention: 'high', why: 'Read it.' },
        { file: 'c.ts', start: 4, end: 9, attention: 'critical', why: 'The call.' },
        { file: 'e.ts', start: 1, end: 1, attention: 'high', why: 'Read it too.' },
      ],
    },
  ],
  checks: [
    { name: 'lint', outcome: 'pass', detail: null },
    { name: 'test', outcome: 'fail', detail: null },
    { name: 'e2e', outcome: 'skipped', detail: null },
  ],
  decisions: [{ decision: 'No new prop', reason: 'Not needed.', file: null, line: null }],
};

describe('serializeReportMarkdown', () => {
  test('writes the headline, what changed, the checks and the decisions', () => {
    expect(serializeReportMarkdown(REPORT)).toBe(
      [
        'Clamp the tab width',
        '### What changed\n- **Find it**: Traced it.\n- **Fix it**: Clamped it.',
        '### Checks\n- ✓ lint\n- ✗ test\n- – e2e',
        '### Decisions\n- **No new prop** Not needed.',
      ].join('\n\n')
    );
  });

  test('a report with nothing else is just its headline', () => {
    expect(serializeReportMarkdown({ headline: 'Done', phases: [], checks: [], decisions: [] })).toBe('Done');
  });
});

describe('listRankedSpots', () => {
  test('ranks by attention, then keeps reading order', () => {
    expect(listRankedSpots(REPORT).map((entry) => entry.spot.file)).toEqual([
      'c.ts',
      'd.ts',
      'b.ts',
      'e.ts',
      'a.ts',
    ]);
    expect(listRankedSpots(REPORT)[0]).toMatchObject({ phaseIndex: 1, spotIndex: 1 });
  });
});
