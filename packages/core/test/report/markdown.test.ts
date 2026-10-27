import { describe, expect, test } from 'bun:test';
import {
  listRankedSpots,
  type PlanDocument,
  serializePlanMarkdown,
  serializeReportMarkdown,
  serializeTestingMarkdown,
  type WorkReport,
} from '../../src/index.ts';

const PLAN: PlanDocument = {
  goal: 'Stop the tabs scrolling.',
  phases: [
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

describe('serializePlanMarkdown', () => {
  test('writes every section in reading order', () => {
    expect(serializePlanMarkdown(PLAN)).toBe(
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

  test('writes the plan parameters: the evidence, the extra checks and the impact', () => {
    const markdown = serializePlanMarkdown({
      ...PLAN,
      evidence: ['screenshot', 'test'],
      checks: ['bun test tabs'],
      operation: ['Backfill the widths.'],
      impact: 'Touches 40 rows.',
    });
    expect(markdown).toContain('## Evidence\nscreenshot, test');
    expect(markdown).toContain('## Extra checks\n- `bun test tabs`');
    expect(markdown).toContain('## Operation\n1. Backfill the widths.\n\n## Impact\nTouches 40 rows.');
  });

  test('leaves out empty sections', () => {
    const bare = {
      ...PLAN,
      phases: [],
      behaviour: [],
      files: [],
      outOfScope: [],
      verification: [],
      questions: [],
    };
    expect(serializePlanMarkdown(bare)).toBe(
      '## Goal\nStop the tabs scrolling.\n\n## Approach\nClamp the width.'
    );
  });
});

const REPORT: WorkReport = {
  headline: 'Clamp the tab width',
  sections: [
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
  judgementCalls: [
    {
      title: 'No new prop',
      call: 'Kept the props as they are',
      reason: 'Not needed.',
      file: null,
      line: null,
    },
  ],
};

const MIGRATION_STEP = {
  when: 'post_merge' as const,
  kind: 'migration' as const,
  title: 'Run the migration',
  detail: 'Adds the invoices table.',
  command: null,
};

describe('serializeReportMarkdown', () => {
  test('writes the headline, what changed, the checks and the judgement calls', () => {
    expect(serializeReportMarkdown(REPORT)).toBe(
      [
        'Clamp the tab width',
        '### What changed\n- **Find it**: Traced it.\n- **Fix it**: Clamped it.',
        '### Checks\n- ✓ lint\n- ✗ test\n- – e2e',
        '### Judgement calls\n- **No new prop**: Kept the props as they are. Not needed.',
      ].join('\n\n')
    );
  });

  test('leads with how it works when the agent wrote a walkthrough', () => {
    const walkthrough = {
      approach: 'Clamp at the source.',
      flow: 'x',
      risks: [],
      testing: { automated: [], manual: [] },
    };
    expect(
      serializeReportMarkdown({ headline: 'Done', sections: [], checks: [], judgementCalls: [], walkthrough })
    ).toBe('Done\n\n### How it works\nClamp at the source.');
  });

  test('ends with the steps before and after the merge as task lists, a command in a shell block', () => {
    const walkthrough = {
      approach: 'Verify first.',
      flow: 'x',
      risks: [],
      testing: { automated: [], manual: [] },
      steps: [
        {
          when: 'post_merge' as const,
          kind: 'migration' as const,
          title: 'Run the migration',
          detail: 'Adds the invoices table.',
          command: 'bun run db:migrate',
        },
        {
          when: 'pre_merge' as const,
          kind: 'env' as const,
          title: 'Set INVOICE_FROM',
          detail: 'In production.',
          command: null,
        },
      ],
    };
    expect(
      serializeReportMarkdown({ headline: 'Done', sections: [], checks: [], judgementCalls: [], walkthrough })
    ).toBe(
      [
        'Done',
        '### How it works\nVerify first.',
        '### Pre-merge steps\n- [ ] **Set INVOICE_FROM**: In production.',
        '### Post-merge steps\n- [ ] **Run the migration**: Adds the invoices table.\n  ```sh\n  bun run db:migrate\n  ```',
      ].join('\n\n')
    );
  });

  test('writes how to test it before the merge steps: what the tests cover, then numbered steps', () => {
    const walkthrough = {
      approach: 'Copy it.',
      flow: 'x',
      risks: [],
      testing: {
        automated: ['duplicate.test.ts covers both kinds.'],
        manual: [
          {
            action: 'Open the paywalls.',
            target: { kind: 'url' as const, value: 'http://localhost:5173/paywalls' },
            expect: 'The list loads.',
          },
        ],
      },
      steps: [{ ...MIGRATION_STEP }],
    };
    expect(
      serializeReportMarkdown({ headline: 'Done', sections: [], checks: [], judgementCalls: [], walkthrough })
    ).toBe(
      [
        'Done',
        '### How it works\nCopy it.',
        '### How to test\n**Covered by tests**\n- duplicate.test.ts covers both kinds.\n\n**Try it yourself**\n1. Open the paywalls: <http://localhost:5173/paywalls>\n   Expected: The list loads.',
        '### Post-merge steps\n- [ ] **Run the migration**: Adds the invoices table.',
      ].join('\n\n')
    );
  });

  test('a report with nothing else is just its headline', () => {
    expect(serializeReportMarkdown({ headline: 'Done', sections: [], checks: [], judgementCalls: [] })).toBe(
      'Done'
    );
  });
});

describe('serializeTestingMarkdown', () => {
  test('writes each kind of target so it reads in a pull request', () => {
    expect(
      serializeTestingMarkdown({
        automated: [],
        manual: [
          {
            action: 'Read the copy step.',
            target: { kind: 'file', value: 'shinsa://file/src/a.ts#L3-L4' },
            expect: 'It copies the code.',
          },
          { action: 'Start it', target: { kind: 'command', value: 'bun dev' }, expect: 'A URL.' },
          {
            action: 'Seed it:',
            target: { kind: 'command', value: 'bun run seed\nbun dev' },
            expect: 'Two tasks.',
          },
          { action: 'Open the list.', target: { kind: 'screen', value: 'Paywalls' }, expect: 'Both kinds.' },
          {
            action: 'Look at the path.',
            target: { kind: 'file', value: '../a.ts' },
            expect: 'Shown as given.',
          },
          { action: 'Try an empty name.', target: null, expect: 'It is refused.' },
        ],
      })
    ).toBe(
      [
        '### How to test',
        '**Try it yourself**',
        '1. Read the copy step: `src/a.ts:3-4`',
        '   Expected: It copies the code.',
        '2. Start it: `bun dev`',
        '   Expected: A URL.',
        '3. Seed it:',
        '   ```sh',
        '   bun run seed',
        '   bun dev',
        '   ```',
        '   Expected: Two tasks.',
        '4. Open the list: *Paywalls*',
        '   Expected: Both kinds.',
        '5. Look at the path: `../a.ts`',
        '   Expected: Shown as given.',
        '6. Try an empty name.',
        '   Expected: It is refused.',
      ].join('\n')
    );
  });

  test('writes nothing for an empty guide', () => {
    expect(serializeTestingMarkdown({ automated: [], manual: [] })).toBe('');
    expect(serializeTestingMarkdown(null)).toBe('');
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
    expect(listRankedSpots(REPORT)[0]).toMatchObject({ sectionIndex: 1, spotIndex: 1 });
  });
});
