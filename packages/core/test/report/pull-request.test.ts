import { describe, expect, test } from 'bun:test';
import type { Evidence, PhaseReport, Round, Task } from '../../src/index.ts';
import {
  listPullRequestEvidence,
  PULL_REQUEST_BLOCK_END,
  PULL_REQUEST_BLOCK_START,
  replacePullRequestBlock,
  resolvePublicUrl,
  resolveShinsaTaskUrl,
  serializePullRequestMarkdown,
} from '../../src/report/index.ts';
import { buildAll, checkResult, createHarness, createTask, PASSING } from '../harness.ts';

const UPLOADED = 'https://github.com/user-attachments/assets';

function builtTask(): Task {
  const harness = createHarness();
  const taskId = createTask(harness);
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  return harness.task(taskId);
}

function withReports(task: Task): Task {
  const at = task.createdAt;
  const phases: PhaseReport[] = [
    {
      index: 0,
      summary: 'Found the overflow.',
      spots: [
        { file: 'src/tabs.tsx', start: 4, end: 9, attention: 'critical', why: 'Clamps the width.' },
        { file: 'src/tabs.css', start: 1, end: 2, attention: 'normal', why: 'Context.' },
      ],
      judgementCalls: [
        {
          title: 'Clamp width',
          call: 'Clamp at 240px',
          reason: 'Fits the longest label',
          file: null,
          line: null,
          alternatives: [{ option: 'scroll the tabs', rejected: 'Hides the active tab.' }],
        },
      ],
      walkthrough: null,
      at,
    },
    {
      index: 1,
      summary: 'Clamped it.',
      spots: [],
      judgementCalls: [],
      walkthrough: {
        approach: 'Clamp the tab width in one place.',
        flow: 'tabs → clamp → render',
        risks: [{ title: 'Long labels', risk: 'They truncate.', file: null, line: null, end: null }],
        testing: {
          automated: ['`test/tabs.test.ts` proves the clamp.'],
          manual: [{ action: 'Open a long tab group', target: null, expect: 'No scroll.' }],
        },
        steps: [
          { when: 'pre_merge', kind: 'env', title: 'Set TAB_LIMIT', detail: 'In production.', command: null },
        ],
      },
      at,
    },
  ];
  return { ...task, handle: 'LOC-28', summary: 'Tabs stay put.', phaseReports: phases };
}

function piece(task: Task, overrides: Partial<Evidence> & Pick<Evidence, 'id' | 'kind' | 'title' | 'uri'>) {
  return { taskId: task.id, runId: 'run-1', attachedAt: 1, ...overrides } as Evidence;
}

describe('serializePullRequestMarkdown', () => {
  test('writes the review as one marked block, from the task link to the footer, in reading order', () => {
    const task = withReports(builtTask());
    const markdown = serializePullRequestMarkdown({ task, evidence: [], notes: {} });
    const headings = [
      PULL_REQUEST_BLOCK_START,
      `> Shinsa task **LOC-28, ${task.title}**. [Open it in Shinsa](${resolveShinsaTaskUrl(task.id)})`,
      'Tabs stay put.',
      '### How it works\nClamp the tab width in one place.',
      '<details><summary>How it flows</summary>\n\ntabs → clamp → render',
      '### Checks\n3 of 3 passed.',
      '| ✓ | Panel tests |',
      '### What changed\n- **Find the overflow**: Found the overflow.\n  - `src/tabs.tsx#L4-L9`: Clamps the width.',
      '### Judgement calls\n- **Clamp width**: Clamp at 240px. Fits the longest label\n  - Not scroll the tabs: Hides the active tab.',
      '### Risks\n- **Long labels**: They truncate.',
      '### How to test',
      '`test/tabs.test.ts` proves the clamp.',
      '### Pre-merge steps\n- [ ] **Set TAB_LIMIT**: In production.',
      '<details><summary>Plan</summary>',
      '<sub>Made with [Shinsa](https://shinsa.dev). Hand over the work. Keep the decisions.</sub>',
      PULL_REQUEST_BLOCK_END,
    ];
    const positions = headings.map((heading) => markdown.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(markdown).not.toContain('src/tabs.css');
    expect(markdown).not.toContain('### Evidence');
  });

  test('without a handle, a plan or checks, it names the task by title and leaves those sections out', () => {
    const task = { ...builtTask(), handle: null, plan: null, checkResults: null, summary: null };
    const markdown = serializePullRequestMarkdown({ task, evidence: [], notes: {} });
    expect(markdown).toContain(`Shinsa task **${task.title}**.`);
    expect(markdown).not.toContain('### Checks');
    expect(markdown).not.toContain('<summary>Plan</summary>');
    expect(markdown).not.toContain('How it flows');
  });

  test('marks failing and skipped checks, escapes pipes and gives the changed-line coverage', () => {
    const task: Task = {
      ...builtTask(),
      checkResults: [
        { ...checkResult('c1', 'fail'), command: 'bun test | tee out', note: 'fails_on_base' },
        checkResult('r1', 'skipped'),
      ],
      coverage: { status: 'measured', command: 'bun test', covered: 8, executable: 10, files: [] },
    };
    const markdown = serializePullRequestMarkdown({ task, evidence: [], notes: {} });
    expect(markdown).toContain('0 of 2 passed.');
    expect(markdown).toContain(
      '| ✗ | Panel tests (already failing on the base branch) | `bun test \\| tee out` |'
    );
    expect(markdown).toContain('| – |');
    expect(markdown).toContain('The tests cover 8 of 10 changed lines.');
  });

  test('shows a before and after as a table, screenshots inline, recordings on their own line', () => {
    const task = builtTask();
    const evidence = [
      piece(task, {
        id: 'b',
        kind: 'screenshot',
        title: 'Settings',
        uri: '/api/evidence/b.png',
        uploadUrl: `${UPLOADED}/b`,
        stage: 'before',
        width: 900,
        theme: 'dark',
        detail: 'The labels read clearly.',
        key: 'settings',
      }),
      piece(task, {
        id: 'a',
        kind: 'screenshot',
        title: 'Settings',
        uri: '/api/evidence/a.png',
        uploadUrl: `${UPLOADED}/a`,
        stage: 'after',
        width: 900,
        theme: 'dark',
        key: 'settings',
      }),
      piece(task, {
        id: 'shot',
        kind: 'screenshot',
        title: 'Menu',
        uri: 'https://example.com/menu.png',
      }),
      piece(task, { id: 'rec', kind: 'recording', title: 'Drag', uri: '/r.mp4', uploadUrl: `${UPLOADED}/r` }),
    ];
    const markdown = serializePullRequestMarkdown({ task, evidence, notes: {} });
    expect(markdown).toContain(
      [
        '### Evidence\n**Settings** (900px, dark)',
        'The labels read clearly.',
        `| Before | After |\n| --- | --- |\n| ![Before](${UPLOADED}/b) | ![After](${UPLOADED}/a) |`,
        '**Menu**',
        '![Menu](https://example.com/menu.png)',
        '**Drag**',
        `${UPLOADED}/r`,
      ].join('\n\n')
    );
  });

  test('a comparison with a recording shows each labelled part in turn', () => {
    const task = builtTask();
    const evidence = [
      piece(task, {
        id: 'one',
        kind: 'recording',
        title: 'Flow',
        uri: '/1.mp4',
        uploadUrl: `${UPLOADED}/1`,
        itemId: 'item',
        label: 'Empty',
      }),
      piece(task, {
        id: 'two',
        kind: 'screenshot',
        title: 'Flow',
        uri: '/2.png',
        uploadUrl: `${UPLOADED}/2`,
        itemId: 'item',
      }),
    ];
    const markdown = serializePullRequestMarkdown({ task, evidence, notes: {} });
    expect(markdown).toContain(`**Flow**\n\nEmpty\n\n${UPLOADED}/1\n\nPart 2\n\n![Flow](${UPLOADED}/2)`);
  });

  test('notes fold open, previews link, and what GitHub cannot show links to Shinsa', () => {
    const task = builtTask();
    const link = resolveShinsaTaskUrl(task.id);
    const evidence = [
      piece(task, { id: 'note', kind: 'note', title: 'Timings', uri: '/n.md' }),
      piece(task, { id: 'empty', kind: 'note', title: 'Blank', uri: '/e.md' }),
      piece(task, { id: 'web', kind: 'preview', title: 'Preview', uri: 'https://pr-1.example.com' }),
      piece(task, { id: 'local', kind: 'preview', title: 'Local', uri: 'http://localhost:5181/' }),
      piece(task, { id: 'raw', kind: 'screenshot', title: 'Raw', uri: '/api/evidence/raw.png', width: 1280 }),
      piece(task, { id: 'check', kind: 'test', title: 'Tests', uri: '/c.txt', checkId: 'c1' }),
    ];
    const markdown = serializePullRequestMarkdown({
      task,
      evidence,
      notes: { note: '| a | b |\n', empty: '  ' },
    });
    expect(markdown).toContain('<details><summary><b>Timings</b></summary>\n\n| a | b |\n\n</details>');
    expect(markdown).toContain(`- **Blank**, a note: [open it in Shinsa](${link})`);
    expect(markdown).toContain('- **Preview**: <https://pr-1.example.com>');
    expect(markdown).toContain(`- **Local**, a preview: [open it in Shinsa](${link})`);
    expect(markdown).toContain(`- **Raw** (1280px), a screenshot: [open it in Shinsa](${link})`);
    expect(markdown).not.toContain('Tests');
  });

  test('stays within the limit by dropping the plan and the flow first, then cutting as a last resort', () => {
    const base = withReports(builtTask());
    const task = { ...base, plan: base.plan && { ...base.plan, body: 'p'.repeat(5000) } };
    const withoutPlan = serializePullRequestMarkdown({
      task: { ...task, plan: null },
      evidence: [],
      notes: {},
    });
    const limit = withoutPlan.length - 10;
    const fitted = serializePullRequestMarkdown({ task, evidence: [], notes: {} }, limit);
    expect(fitted.length).toBeLessThanOrEqual(limit);
    expect(fitted).not.toContain('<summary>Plan</summary>');
    expect(fitted).not.toContain('How it flows');
    expect(fitted).toContain('### Checks');
    const cut = serializePullRequestMarkdown(
      { task: { ...task, summary: 's'.repeat(400) }, evidence: [], notes: {} },
      300
    );
    expect(cut).toHaveLength(300);
    expect(cut.endsWith(`…\n${PULL_REQUEST_BLOCK_END}`)).toBe(true);
  });

  test('a last-resort cut closes the fold and the code block it lands in', () => {
    const base = withReports(builtTask());
    const folded = serializePullRequestMarkdown(
      {
        task: { ...base, summary: `<details><summary>Log</summary>\n\n${'y'.repeat(400)}` },
        evidence: [],
        notes: {},
      },
      400
    );
    expect(folded.length).toBeLessThanOrEqual(400);
    expect(folded.endsWith(`…\n\n</details>\n${PULL_REQUEST_BLOCK_END}`)).toBe(true);
    const [first, second] = base.phaseReports as [PhaseReport, PhaseReport];
    const walkthrough = second.walkthrough as NonNullable<PhaseReport['walkthrough']>;
    const step = {
      when: 'pre_merge',
      kind: 'env',
      title: 'Run it',
      detail: 'Once.',
      command: 'z'.repeat(800),
    } as const;
    const task = {
      ...base,
      phaseReports: [first, { ...second, walkthrough: { ...walkthrough, steps: [step] } }],
    };
    const fenced = serializePullRequestMarkdown({ task, evidence: [], notes: {} }, 600);
    expect(fenced.length).toBeLessThanOrEqual(600);
    expect(fenced.endsWith(`…\n\`\`\`\n${PULL_REQUEST_BLOCK_END}`)).toBe(true);
  });
});

function round(number: number, overrides: Partial<Round> = {}): Round {
  return {
    number,
    title: `Round ${number} work`,
    request: 'Do it',
    why: null,
    shipping: 'onto_pull_request',
    status: 'shipped',
    pipeline: [],
    branch: 'fix/tabs',
    base: 'main',
    pullRequest: { number: 42, url: 'https://github.com/acme/app/pull/42', state: 'open', base: 'main' },
    queuedAt: 0,
    startedAt: number,
    endedAt: null,
    outcome: null,
    ...overrides,
  };
}

describe('a pull request that carries several rounds', () => {
  test('describes the earlier rounds on it and shows their evidence beside this round’s', () => {
    const base = withReports(builtTask());
    const task: Task = {
      ...base,
      pullRequest: { ...(base.pullRequest ?? {}), number: 42 } as Task['pullRequest'],
      rounds: [
        round(1, {
          title: 'Clamp the tabs',
          outcome: {
            goal: 'Stop the scroll.',
            phases: ['Find it', 'Fix it'],
            headline: null,
            result: 'Merged into the PR.',
          },
        }),
        round(2, { title: 'Stacked elsewhere', pullRequest: null }),
        round(3, { title: 'Bare round', outcome: null }),
        round(4, { status: 'active', endedAt: null }),
      ],
    };
    const evidence = [
      piece(task, { id: 'first', kind: 'screenshot', title: 'First', uri: 'https://cdn.example.com/1.png' }),
      piece(task, {
        id: 'stacked',
        kind: 'screenshot',
        title: 'Stacked',
        uri: 'https://cdn.example.com/2.png',
        round: 2,
      }),
      piece(task, {
        id: 'now',
        kind: 'screenshot',
        title: 'Now',
        uri: 'https://cdn.example.com/4.png',
        round: 4,
      }),
    ];
    const markdown = serializePullRequestMarkdown({ task, evidence, notes: {} });
    expect(markdown).toContain(
      '### Earlier rounds in this pull request\n- **Round 1, Clamp the tabs**: Stop the scroll. Merged into the PR.\n  - Find it\n  - Fix it\n- **Round 3, Bare round**'
    );
    expect(markdown).not.toContain('Stacked elsewhere');
    expect(markdown).toContain('### What changed in round 4');
    expect(listPullRequestEvidence(task, evidence).map((item) => item.title)).toEqual(['First', 'Now']);
  });

  test('before its pull request opens, a round shows only its own work', () => {
    const task: Task = {
      ...builtTask(),
      pullRequest: null,
      rounds: [round(1), round(2, { status: 'active' })],
    };
    const markdown = serializePullRequestMarkdown({ task, evidence: [], notes: {} });
    expect(markdown).not.toContain('Earlier rounds');
    expect(markdown).toContain('### What changed\n');
  });
});

describe('listPullRequestEvidence', () => {
  test('keeps only the current evidence of this task’s current round', () => {
    const task = builtTask();
    const evidence = [
      piece(task, { id: 'keep', kind: 'screenshot', title: 'Keep', uri: '/k.png' }),
      piece(task, { id: 'old', kind: 'screenshot', title: 'Old', uri: '/o.png', round: 2 }),
      piece(task, { id: 'gone', kind: 'screenshot', title: 'Gone', uri: '/g.png', removedAt: 2 }),
      { ...piece(task, { id: 'other', kind: 'screenshot', title: 'Other', uri: '/x.png' }), taskId: 'x' },
    ];
    expect(listPullRequestEvidence(task, evidence).map((item) => item.title)).toEqual(['Keep']);
  });
});

describe('resolvePublicUrl', () => {
  test('prefers the uploaded address, then a public web address, else nothing', () => {
    const task = builtTask();
    const shot = piece(task, { id: 's', kind: 'screenshot', title: 'S', uri: '/api/evidence/s.png' });
    expect(resolvePublicUrl(shot)).toBeNull();
    expect(resolvePublicUrl({ ...shot, uploadUrl: `${UPLOADED}/s` })).toBe(`${UPLOADED}/s`);
    expect(resolvePublicUrl({ ...shot, uri: 'https://cdn.example.com/s.png' })).toBe(
      'https://cdn.example.com/s.png'
    );
    expect(resolvePublicUrl({ ...shot, uri: 'http://127.0.0.1:7446/s.png' })).toBeNull();
  });
});

describe('replacePullRequestBlock', () => {
  const block = `${PULL_REQUEST_BLOCK_START}\nnew\n${PULL_REQUEST_BLOCK_END}`;

  test('replaces only the marked block and keeps what a person wrote around it', () => {
    const body = `Intro\n\n${PULL_REQUEST_BLOCK_START}\nold\n${PULL_REQUEST_BLOCK_END}\n\nOutro`;
    expect(replacePullRequestBlock(body, block)).toBe(`Intro\n\n${block}\n\nOutro`);
  });

  test('writes the block alone when the markers are gone or the kept text would pass the limit', () => {
    expect(replacePullRequestBlock('A body someone rewrote', block)).toBe(block);
    expect(replacePullRequestBlock(`${PULL_REQUEST_BLOCK_START} only`, block)).toBe(block);
    const long = `${'x'.repeat(100)}${PULL_REQUEST_BLOCK_START}\nold\n${PULL_REQUEST_BLOCK_END}`;
    expect(replacePullRequestBlock(long, block, 60)).toBe(block);
  });
});
