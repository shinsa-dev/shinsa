import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  AUTOPILOT_CONTEXT_LIMITS,
  AUTOPILOT_JUDGE_SYSTEM,
  type AutopilotContextSection,
  type AutopilotDecision,
  type Gate,
  type ShinsaState,
  type Task,
  listAutopilotContextSections,
  resolveAutopilotAreas,
  resolveAutopilotContextLines,
  selectAutopilotJudgeRequest,
} from '../../src/index.ts';
import { createHarness, createTask } from '../harness.ts';

function setup(overrides: Partial<Task> = {}) {
  const harness = createHarness();
  const taskId = createTask(harness, { request: 'Add a confirm dialog' });
  const task: Task = { ...harness.task(taskId), ...overrides };
  const state: ShinsaState = { ...harness.state, tasks: { ...harness.state.tasks, [taskId]: task } };
  return { state, task };
}

function section(state: ShinsaState, task: Task, name: AutopilotContextSection['name'], replies = []) {
  return listAutopilotContextSections(state, task, replies).find((candidate) => candidate.name === name);
}

const WALKTHROUGH = {
  approach: 'Wrap the delete button in a dialog.',
  flow: '',
  risks: [{ title: 'Focus', risk: 'Focus may not return.', file: null, line: null, end: null }],
  testing: { automated: [], manual: [] },
};

function decision(taskId: string, at: number, extra: Partial<AutopilotDecision> = {}): AutopilotDecision {
  return {
    at,
    taskId,
    gateId: null,
    kind: 'review',
    answer: 'approved',
    projectId: null,
    risk: null,
    scope: null,
    urgent: false,
    watchdog: false,
    touched: false,
    guess: null,
    followUp: null,
    note: null,
    facts: null,
    estimate: null,
    ...extra,
  };
}

describe('the judge’s context sections', () => {
  test('a task with nothing yet gives no lines', () => {
    const { state, task } = setup();
    expect(resolveAutopilotContextLines(listAutopilotContextSections(state, task))).toEqual([]);
  });

  test('what changed reads the pull request stats and the reported files', () => {
    const { state, task } = setup({
      pullRequest: {
        number: 1,
        url: 'u',
        state: 'open',
        checks: 'passing',
        unresolvedComments: 0,
        mergeable: true,
        updatedAt: 0,
        changes: { additions: 40, deletions: 3, changedFiles: 2 },
      },
      phaseReports: [
        {
          index: 0,
          summary: 's',
          spots: [],
          judgementCalls: [],
          files: ['apps/web/a.tsx', 'apps/web/b.tsx'],
          at: 1,
        },
        { index: 1, summary: 's', spots: [], judgementCalls: [], files: ['apps/web/a.tsx'], at: 2 },
      ],
    });
    expect(section(state, task, 'changes')?.lines).toEqual([
      'Pull request: 2 files changed, 40 lines added, 3 removed',
      'Files:',
      '- apps/web/a.tsx',
      '- apps/web/b.tsx',
    ]);
  });

  test('before any report, the plan’s files stand in, and a long list is cut with a count', () => {
    const files = Array.from({ length: 22 }, (_, index) => ({ path: `src/f${index}.ts`, change: 'x' }));
    const { state, task } = setup({
      plan: {
        version: 1,
        body: '',
        proposedAt: 0,
        document: {
          goal: 'g',
          phases: [],
          behaviour: [],
          approach: '',
          files,
          outOfScope: [],
          verification: [],
          questions: [],
        },
      },
    });
    const lines = section(state, task, 'changes')?.lines ?? [];
    expect(lines[0]).toBe('Files the plan changes:');
    expect(lines).toHaveLength(1 + AUTOPILOT_CONTEXT_LIMITS.files + 1);
    expect(lines.at(-1)).toBe('- and 2 more');
  });

  test('the walkthrough comes from the report, or else the last phase that wrote one', () => {
    const fromPhase = setup({
      phaseReports: [
        { index: 0, summary: 's', spots: [], judgementCalls: [], walkthrough: WALKTHROUGH, at: 1 },
      ],
    });
    expect(section(fromPhase.state, fromPhase.task, 'walkthrough')?.lines).toEqual([
      'Approach: Wrap the delete button in a dialog.',
      'Risks:',
      '- Focus: Focus may not return.',
    ]);
    const fromReport = setup({
      report: {
        headline: 'h',
        sections: [],
        checks: [],
        judgementCalls: [],
        walkthrough: { ...WALKTHROUGH, approach: 'From the report.', risks: [] },
      },
    });
    expect(section(fromReport.state, fromReport.task, 'walkthrough')?.lines).toEqual([
      'Approach: From the report.',
    ]);
  });

  test('the review leads with its summary and ratings, then findings by severity', () => {
    const { state, task } = setup({
      reviewSummary: 'Looks right.',
      reviewRatings: { confidence: 'high', risk: 'low' },
      findings: [
        { severity: 'optional', file: null, line: null, message: 'Rename it.' },
        { severity: 'blocking', file: 'src/a.ts', line: 4, message: 'Crashes.', verdict: 'fix' },
        { severity: 'should_fix', file: 'src/b.ts', line: null, title: 'Leak', message: 'long' },
      ],
    });
    expect(section(state, task, 'review')?.lines).toEqual([
      'Summary: Looks right.',
      'Ratings: confidence high, risk low',
      'Findings:',
      '- blocking src/a.ts:4: Crashes. (you marked it fix)',
      '- should fix src/b.ts: Leak',
      '- optional: Rename it.',
    ]);
  });

  test('your messages are yours only, the last few, oldest first', () => {
    const entry = { evidenceId: null, text: 't' } as const;
    const { state, task } = setup({
      activity: [
        { ...entry, at: 1, actor: 'you', kind: 'message', detail: 'one' },
        { ...entry, at: 2, actor: 'agent', kind: 'message', detail: 'not mine' },
        { ...entry, at: 3, actor: 'you', kind: 'message', detail: 'sent for me', onBehalf: true },
        { ...entry, at: 4, actor: 'you', kind: 'round', detail: 'two' },
        { ...entry, at: 5, actor: 'you', kind: 'message', detail: null },
        { ...entry, at: 6, actor: 'you', kind: 'message', detail: 'three' },
        { ...entry, at: 7, actor: 'you', kind: 'message', detail: 'four' },
        { ...entry, at: 8, actor: 'you', kind: 'message', detail: 'five' },
      ],
    });
    expect(section(state, task, 'messages')?.lines).toEqual(['- “two”', '- “three”', '- “four”', '- “five”']);
  });

  test('the agent’s replies are the latest few, oldest first', () => {
    const { state, task } = setup();
    const replies = [
      { at: 3, text: 'third' },
      { at: 1, text: 'first' },
      { at: 4, text: 'fourth' },
      { at: 2, text: 'second' },
    ];
    expect(
      listAutopilotContextSections(state, task, replies).find((s) => s.name === 'replies')?.lines
    ).toEqual(['- second', '- third', '- fourth']);
  });
});

describe('your recent tasks in the same part of the app', () => {
  test('an area is the first two folders of a path, leaving docs and root files out', () => {
    expect(
      resolveAutopilotAreas([
        'packages/core/src/a.ts',
        'apps/web/x.tsx',
        'docs/engine.md',
        'README',
        'src/a.ts',
      ])
    ).toEqual(['packages/core', 'apps/web', 'src']);
  });

  test('lists the latest tasks you decided that share an area, with what you decided and your words', () => {
    const harness = createHarness();
    const make = (request: string) => harness.task(createTask(harness, { request }));
    const current = make('Add a confirm dialog');
    const same = make('Restyle the dialog');
    const elsewhere = make('Fix the engine');
    const otherRepo = make('Other repo');
    const older = make('Older dialog');
    const editing = (task: Task, path: string, repoId = task.repoId): Task => ({
      ...task,
      repoId,
      editedPaths: [path],
    });
    const tasks = {
      ...harness.state.tasks,
      [current.id]: editing(current, 'apps/web/src/dialog.tsx'),
      [same.id]: editing(same, 'apps/web/src/style.css'),
      [elsewhere.id]: editing(elsewhere, 'apps/engine/src/a.ts'),
      [otherRepo.id]: editing(otherRepo, 'apps/web/src/a.ts', 'another-repo'),
      [older.id]: editing(older, 'apps/web/src/old.tsx'),
    };
    const state: ShinsaState = {
      ...harness.state,
      tasks,
      autopilotProfile: {
        ...harness.state.autopilotProfile,
        decisions: [
          decision(older.id, 1),
          decision(same.id, 2, { kind: 'plan' }),
          decision(same.id, 3, { answer: 'revised', note: 'Use the kit’s dialog.' }),
          decision(same.id, 4, { kind: 'message', answer: 'sent' }),
          decision(elsewhere.id, 5),
          decision(otherRepo.id, 6),
          decision(current.id, 7),
          decision('gone', 8),
        ],
      },
    };
    expect(section(state, tasks[current.id] as Task, 'area')?.lines).toEqual([
      `- “${same.title}” (apps/web): plan approved, review revised. You wrote: “Use the kit’s dialog.”`,
      `- “${older.title}” (apps/web): review approved.`,
    ]);
  });
});

describe('the budget', () => {
  const big = (name: AutopilotContextSection['name'], count: number): AutopilotContextSection => ({
    name,
    title: `${name}:`,
    lines: Array.from({ length: count }, (_, index) => `${name} ${index} ${'x'.repeat(90)}`),
  });

  test('caps each section on its own', () => {
    const lines = resolveAutopilotContextLines([big('area', 50)]);
    expect(lines.join('\n').length).toBeLessThanOrEqual(AUTOPILOT_CONTEXT_LIMITS.sections.area + 10);
  });

  test('cuts the lowest-priority sections first and says what it left out', () => {
    const sections = (['area', 'replies', 'messages', 'walkthrough', 'changes', 'review'] as const).map(
      (name) => big(name, 50)
    );
    const lines = resolveAutopilotContextLines(sections);
    const text = lines.join('\n');
    expect(text.length).toBeLessThanOrEqual(AUTOPILOT_CONTEXT_LIMITS.budget + 200);
    expect(lines[1]).toBe('review:');
    expect(text).toContain('replies:');
    expect(text).not.toContain('area:');
    expect(lines.at(-1)).toBe('Left out to fit: your earlier tasks in this part of the app.');
  });
});

describe('the judge request', () => {
  test('carries the context in the user turn and keeps the system prompt fixed', () => {
    const { state, task } = setup({ reviewSummary: 'Looks right.' });
    const gate: Gate = {
      id: 'g1',
      taskId: task.id,
      type: 'question',
      status: 'open',
      title: 'Which one?',
      body: 'Two.',
      runId: null,
      openedAt: 0,
      answeredAt: null,
      decision: null,
      response: null,
      autopilotJudging: true,
    };
    const request = selectAutopilotJudgeRequest({ ...state, gates: { g1: gate } }, 'g1', 10, false, [
      { at: 1, text: 'I found two containers.' },
    ]);
    const value = Option.getOrThrow(request);
    expect(value.system).toBe(AUTOPILOT_JUDGE_SYSTEM);
    expect(value.prompt).toContain('The review:\nSummary: Looks right.');
    expect(value.prompt).toContain('The agent’s latest replies, oldest first:\n- I found two containers.');
    expect(value.prompt.indexOf('Two.')).toBeLessThan(value.prompt.indexOf('The review:'));
  });
});
