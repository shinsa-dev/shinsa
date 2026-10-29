import { describe, expect, test } from 'bun:test';
import type { Evidence, PhaseReport, Task } from '../../src/index.ts';
import {
  parseReviewPayload,
  REVIEW_PAYLOAD_VERSION,
  serializePullRequestMarkdown,
  serializeReviewPayload,
} from '../../src/report/index.ts';
import { buildAll, createHarness, createTask, PASSING } from '../harness.ts';

const UPLOADED = 'https://github.com/user-attachments/assets';

function reviewedTask(): Task {
  const harness = createHarness();
  const taskId = createTask(harness);
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  const task = harness.task(taskId);
  const [first, second] = task.phaseReports as [PhaseReport, PhaseReport];
  return {
    ...task,
    handle: 'LOC-28',
    summary: 'Tabs stay put.',
    phaseReports: [
      {
        ...first,
        judgementCalls: [
          {
            title: 'Clamp width',
            call: 'Clamp at 240px',
            reason: 'Fits the longest label',
            file: 'src/tabs.tsx',
            line: 4,
            alternatives: [{ option: 'scroll the tabs', rejected: 'Hides the active tab.' }],
          },
        ],
      },
      {
        ...second,
        walkthrough: {
          approach: 'Clamp the width.',
          flow: 'tabs → clamp',
          risks: [{ title: 'Long labels', risk: 'They truncate.', file: 'src/tabs.tsx', line: 4, end: 9 }],
          testing: {
            automated: ['`test/tabs.test.ts` proves it.'],
            manual: [
              {
                action: 'Open tabs',
                target: { kind: 'url', value: 'http://localhost:5181' },
                expect: 'No scroll.',
              },
              { action: 'Look', target: null, expect: 'Fine.' },
            ],
          },
        },
      },
    ],
  };
}

function piece(task: Task, fields: Partial<Evidence> & Pick<Evidence, 'id' | 'kind' | 'title' | 'uri'>) {
  return { taskId: task.id, runId: 'run-1', attachedAt: 1, ...fields } as Evidence;
}

describe('serializeReviewPayload', () => {
  test('carries the review without the code, and only evidence a browser can reach', () => {
    const task = reviewedTask();
    const evidence = [
      piece(task, {
        id: 'before',
        kind: 'screenshot',
        title: 'Tabs',
        uri: '/api/evidence/b.png',
        uploadUrl: `${UPLOADED}/b`,
        stage: 'before',
        width: 1280,
        theme: 'dark',
        key: 'tabs',
        detail: 'Scrolls.',
      }),
      piece(task, {
        id: 'after',
        kind: 'screenshot',
        title: 'Tabs',
        uri: '/api/evidence/a.png',
        uploadUrl: `${UPLOADED}/a`,
        stage: 'after',
        width: 1280,
        theme: 'dark',
        key: 'tabs',
      }),
      piece(task, { id: 'local', kind: 'screenshot', title: 'Local', uri: '/api/evidence/l.png' }),
      piece(task, { id: 'note', kind: 'note', title: 'Note', uri: 'https://example.com/n.md' }),
      piece(task, {
        id: 'cdn',
        kind: 'screenshot',
        title: 'Elsewhere',
        uri: 'https://cdn.example.com/x.png',
      }),
    ];
    const failing = {
      id: 'c9',
      label: 'Tests',
      command: 'bun test',
      outcome: 'fail' as const,
      detail: '/Users/me/app: TOKEN=abc',
    };
    const pullRequest = { ...(task.pullRequest ?? {}), number: 23 } as Task['pullRequest'];
    const payload = serializeReviewPayload({ ...task, checkResults: [failing], pullRequest }, evidence);
    expect(payload.report.checks).toEqual([{ ...failing, detail: null }]);
    expect(payload.task).toEqual({
      id: task.id,
      handle: 'LOC-28',
      title: task.title,
      summary: 'Tabs stay put.',
      pullRequest: 23,
      repo: null,
      slug: null,
      branch: task.branch,
      coverage: null,
    });
    expect(serializeReviewPayload({ ...task, pullRequest: null }, []).task.pullRequest).toBeNull();
    expect(payload.report.sections.every((section) => section.spots.length === 0)).toBe(true);
    expect(payload.report.judgementCalls[0]).toMatchObject({ file: null, line: null });
    expect(payload.report.walkthrough?.risks[0]).toMatchObject({ file: null, line: null, end: null });
    expect(payload.evidence.map((part) => [part.id, part.url, part.stage])).toEqual([
      ['before', `${UPLOADED}/b`, 'before'],
      ['after', `${UPLOADED}/a`, 'after'],
    ]);
    expect(payload.evidence[0]?.itemId).toBe(payload.evidence[1]?.itemId as string);
    expect(payload.evidence[0]).toMatchObject({
      width: 1280,
      theme: 'dark',
      detail: 'Scrolls.',
      label: null,
    });
    expect(parseReviewPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  test('carries the agent review’s summary and findings without their code, and none before it ran', () => {
    const task: Task = {
      ...reviewedTask(),
      reviewSummary: 'Looks right.',
      findings: [
        {
          severity: 'suggestion',
          file: 'src/a.ts',
          line: 4,
          title: 'Name it',
          message: 'Give the map a name.',
          fix: 'const x = 1;',
        },
        { severity: 'blocking', file: null, line: null, message: 'Breaks the build.' },
      ],
    };
    const payload = serializeReviewPayload(task, []);
    expect(payload.review).toEqual({
      summary: 'Looks right.',
      findings: [
        { severity: 'suggestion', file: null, line: null, title: 'Name it', message: 'Give the map a name.' },
        { severity: 'blocking', file: null, line: null, message: 'Breaks the build.' },
      ],
    });
    expect(parseReviewPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
    expect(serializeReviewPayload({ ...task, reviewSummary: null }, []).review).toBeNull();
  });

  test('carries the facts the task header shows: repository, its GitHub slug, branch and changed-line coverage', () => {
    const task: Task = {
      ...reviewedTask(),
      branch: 'feat/rich-pr',
      coverage: { status: 'measured', command: 'bun test', covered: 46, executable: 48, files: [] },
    };
    const facts = (remote: string | null) =>
      serializeReviewPayload(task, [], { name: 'shinsa', remote }).task;
    expect(facts('https://github.com/shinsa-dev/shinsa.git')).toMatchObject({
      repo: 'shinsa',
      slug: 'shinsa-dev/shinsa',
      branch: 'feat/rich-pr',
      coverage: { covered: 46, executable: 48 },
    });
    expect(facts('git@github.com:shinsa-dev/shinsa.git').slug).toBe('shinsa-dev/shinsa');
    expect(facts(null).slug).toBeNull();
    const unmeasured = { ...task, coverage: { status: 'unavailable' as const, command: 'x', reason: 'y' } };
    expect(serializeReviewPayload(unmeasured, []).task.coverage).toBeNull();
    const payload = serializeReviewPayload(task, [], {
      name: 'shinsa',
      remote: 'github.com/shinsa-dev/shinsa',
    });
    expect(parseReviewPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  test('a task without a handle, summary or walkthrough still reads back', () => {
    const task = { ...reviewedTask(), handle: undefined, summary: null, phaseReports: [] };
    const payload = serializeReviewPayload(task, []);
    expect(payload.task).toMatchObject({ handle: null, summary: null });
    expect(payload.report.walkthrough).toBeNull();
    expect(parseReviewPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });
});

describe('parseReviewPayload', () => {
  test('reads malformed header facts as none', () => {
    const task = {
      id: 'a',
      title: 'T',
      repo: '../etc',
      slug: 'not a slug',
      branch: 'a b',
      coverage: { covered: 9, executable: 3 },
    };
    expect(parseReviewPayload({ v: REVIEW_PAYLOAD_VERSION, task, report: {} })?.task).toMatchObject({
      repo: null,
      slug: null,
      branch: null,
      coverage: null,
    });
    const partial = { ...task, coverage: { covered: 1 } };
    expect(
      parseReviewPayload({ v: REVIEW_PAYLOAD_VERSION, task: partial, report: {} })?.task.coverage
    ).toBeNull();
    const raw = { ...task, coverage: 'all' };
    expect(
      parseReviewPayload({ v: REVIEW_PAYLOAD_VERSION, task: raw, report: {} })?.task.coverage
    ).toBeNull();
  });

  test('reads a malformed agent review as none and drops malformed findings', () => {
    const base = { v: REVIEW_PAYLOAD_VERSION, task: { id: 'a', title: 'T' }, report: {} };
    expect(parseReviewPayload({ ...base, review: 'yes' })?.review).toBeNull();
    expect(parseReviewPayload({ ...base, review: { findings: [] } })?.review).toBeNull();
    const review = {
      summary: 'Fine.',
      findings: [
        { severity: 'fatal', message: 'x' },
        { severity: 'blocking' },
        { severity: 'blocking', message: 'Ok.' },
      ],
    };
    expect(parseReviewPayload({ ...base, review })?.review).toEqual({
      summary: 'Fine.',
      findings: [{ severity: 'blocking', file: null, line: null, message: 'Ok.' }],
    });
  });

  test('refuses anything that is not a review of this version', () => {
    expect(parseReviewPayload(null)).toBeNull();
    expect(parseReviewPayload([])).toBeNull();
    expect(parseReviewPayload({ v: 2 })).toBeNull();
    expect(parseReviewPayload({ v: REVIEW_PAYLOAD_VERSION, task: {}, report: {} })).toBeNull();
    expect(parseReviewPayload({ v: REVIEW_PAYLOAD_VERSION, task: { id: 'a', title: 'T' } })).toBeNull();
  });

  test('keeps only well-formed parts, no check output, and only images GitHub hosts', () => {
    const payload = parseReviewPayload({
      v: REVIEW_PAYLOAD_VERSION,
      task: { id: 'a', title: 'T', handle: 7, pullRequest: 1.5 },
      report: {
        sections: [
          { title: 'One', summary: 'Did it.', spots: [{ file: 'x' }] },
          { title: 'No summary' },
          'junk',
        ],
        checks: [
          { id: 'c1', label: 'Tests', command: 'bun test', outcome: 'pass', detail: 'secret output' },
          { id: 'c2', label: 'Odd', command: 'x', outcome: 'maybe' },
        ],
        judgementCalls: [
          { title: 'Call', call: 'Do it', alternatives: [{ option: 'a' }, 'b'] },
          { title: 'Half' },
        ],
        walkthrough: {
          approach: 'A',
          risks: [{ title: 'R', risk: 'Bad' }, { title: 'Only title' }],
          testing: {
            automated: ['ok', 3],
            manual: [
              { action: 'Go', expect: 'It works', target: { kind: 'url', value: 'https://x.dev' } },
              { action: 'Go', expect: 'Odd target', target: { kind: 'planet', value: 'x' } },
              { action: 'No expect' },
            ],
          },
        },
      },
      evidence: [
        {
          id: 'e1',
          itemId: 'i',
          kind: 'screenshot',
          title: 'Shot',
          url: 'https://github.com/user-attachments/assets/a',
          width: '9',
          theme: 'dim',
        },
        { id: 'e2', itemId: 'i', kind: 'screenshot', title: 'Bad', url: 'javascript:alert(1)' },
        { id: 'e4', itemId: 'i', kind: 'screenshot', title: 'Fake', url: 'https://evil.example/pass.png' },
        {
          id: 'e5',
          itemId: 'i',
          kind: 'recording',
          title: 'Raw',
          url: 'https://private-user-images.githubusercontent.com/1/v.mp4',
        },
        { id: 'e3', itemId: 'i', kind: 'note', title: 'Note', url: 'https://x.dev/n' },
      ],
    });
    expect(payload?.task).toEqual({
      id: 'a',
      handle: null,
      title: 'T',
      summary: null,
      pullRequest: null,
      repo: null,
      slug: null,
      branch: null,
      coverage: null,
    });
    const numbered = parseReviewPayload({
      v: REVIEW_PAYLOAD_VERSION,
      task: { id: 'a', title: 'T', pullRequest: 23 },
      report: {},
    });
    expect(numbered?.task.pullRequest).toBe(23);
    expect(payload?.report.headline).toBe('');
    expect(payload?.report.sections).toEqual([{ title: 'One', summary: 'Did it.', spots: [] }]);
    expect(payload?.report.checks).toEqual([
      { id: 'c1', label: 'Tests', command: 'bun test', outcome: 'pass', detail: null },
    ]);
    expect(payload?.report.judgementCalls).toEqual([
      { title: 'Call', call: 'Do it', reason: '', file: null, line: null, end: null, alternatives: [] },
    ]);
    expect(payload?.report.walkthrough).toEqual({
      approach: 'A',
      flow: '',
      risks: [{ title: 'R', risk: 'Bad', file: null, line: null, end: null }],
      testing: {
        automated: ['ok'],
        manual: [
          { action: 'Go', expect: 'It works', target: { kind: 'url', value: 'https://x.dev' } },
          { action: 'Go', expect: 'Odd target', target: null },
        ],
      },
    });
    expect(payload?.evidence).toEqual([
      {
        id: 'e1',
        itemId: 'i',
        kind: 'screenshot',
        title: 'Shot',
        url: 'https://github.com/user-attachments/assets/a',
        detail: null,
        width: null,
        theme: null,
        stage: null,
        label: null,
      },
      {
        id: 'e5',
        itemId: 'i',
        kind: 'recording',
        title: 'Raw',
        url: 'https://private-user-images.githubusercontent.com/1/v.mp4',
        detail: null,
        width: null,
        theme: null,
        stage: null,
        label: null,
      },
    ]);
  });

  test('a walkthrough without testing, and fields of the wrong kind, read as empty', () => {
    const payload = parseReviewPayload({
      v: REVIEW_PAYLOAD_VERSION,
      task: { id: 'a', title: 'T' },
      report: { sections: 'x', walkthrough: { risks: 'x' } },
    });
    expect(payload?.report).toEqual({
      headline: '',
      sections: [],
      checks: [],
      judgementCalls: [],
      walkthrough: { approach: '', flow: '', risks: [], testing: { automated: [], manual: [] } },
    });
    expect(payload?.evidence).toEqual([]);
  });
});

describe('the review link in the description', () => {
  test('opens the task with the review in the fragment, which never reaches a server', () => {
    const task = reviewedTask();
    const markdown = serializePullRequestMarkdown({ task, evidence: [], notes: {}, review: 'abc-_' });
    expect(markdown).toContain(`&title=Fix+tab+group+scroll#review=abc-_) to see the full review`);
  });
});
