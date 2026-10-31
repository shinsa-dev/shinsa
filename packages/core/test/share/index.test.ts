import { describe, expect, test } from 'bun:test';
import {
  hasSharedCode,
  resolveSharedFingerprint,
  resolveSharedTask,
  SHARED_EVIDENCE_PREFIX,
  type SharedTaskContext,
  type Task,
} from '../../src/index.ts';
import {
  createHarness,
  createTask,
  type Harness,
  PASSING,
  proposePlan,
  pullRequest,
  registerRepo,
} from '../harness.ts';

const PUBLIC: SharedTaskContext = {
  owner: 'mona',
  machine: 'Studio',
  repository: { name: 'superwall/paywall-next', visibility: 'public' },
};

const PRIVATE: SharedTaskContext = {
  ...PUBLIC,
  repository: { ...PUBLIC.repository!, visibility: 'private' },
};

const UNKNOWN: SharedTaskContext = {
  ...PUBLIC,
  repository: { ...PUBLIC.repository!, visibility: 'unknown' },
};

const REQUEST =
  'Fix the scroll in tab groups\n\n<attachments>\n<attachment kind="image" display_name="shot.png" path="/data/attachments/01b/shot.png" url="/api/attachments/01b/shot.png" />\n</attachments>';

const SUMMARY =
  'Clamped it in [panel.ts](shinsa://file/src/panel.ts#L3) after [the other task](shinsa://task/0193) and shinsa://task/0194 too.';

function attach(harness: Harness, taskId: string, uri: string, kind: 'screenshot' | 'preview' | 'note') {
  harness.send({
    type: 'agent.attach_evidence',
    runId: harness.activeRun(taskId).id,
    kind,
    title: `Shot of [panel.ts](shinsa://file/src/panel.ts)`,
    uri,
    detail: 'See [the task](shinsa://task/0193).',
    width: 900,
    theme: 'dark',
    key: `${kind}-${Object.keys(harness.state.evidence).length}`,
  });
}

function completeLastPhase(harness: Harness, taskId: string) {
  attach(harness, taskId, '/api/evidence/t/round-1/shot.png', 'screenshot');
  attach(harness, taskId, 'http://localhost:5181/tasks', 'preview');
  attach(harness, taskId, 'https://preview.example.dev', 'preview');
  harness.send({
    type: 'agent.attach_check',
    runId: harness.activeRun(taskId).id,
    kind: 'test',
    checkId: 'c1',
  });
  harness.send({
    type: 'agent.complete_phase',
    runId: harness.activeRun(taskId).id,
    summary: 'Did the first phase.',
    spots: [
      { file: 'src/a.ts', start: 1, end: 3, attention: 'critical', why: 'The change.', title: 'Clamp' },
    ],
    judgementCalls: [{ title: 'Clamp', call: 'Clamp it', reason: 'Simple.', file: 'src/a.ts', line: 2 }],
    files: ['src/a.ts'],
  });
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.complete_phase',
    runId: harness.activeRun(taskId).id,
    summary: SUMMARY,
    spots: [{ file: 'src/b.ts', start: 4, end: 9, attention: 'high', why: 'The other change.' }],
    judgementCalls: [],
    walkthrough: {
      approach: 'Clamp the width.',
      flow: 'The panel reads its width.',
      risks: [{ title: 'Narrow', risk: 'It may wrap.', file: 'src/b.ts', line: 4, end: 9 }],
      testing: {
        automated: ['Panel tests'],
        manual: [
          {
            action: 'Open it',
            expect: 'It scrolls.',
            target: { kind: 'url', value: 'https://app.example.dev' },
          },
          {
            action: 'Open local',
            expect: 'It scrolls.',
            target: { kind: 'url', value: 'http://localhost:5181' },
          },
          { action: 'Read it', expect: 'Clamped.', target: { kind: 'file', value: 'src/b.ts:4' } },
        ],
      },
      steps: [
        {
          when: 'post_merge',
          kind: 'migration',
          title: 'Run the migration',
          detail: 'On D1.',
          command: 'bun run migrate',
        },
      ],
      watchdogs: [
        {
          title: 'Errors',
          check: 'No new errors.',
          source: { server: 'maple', data: 'Errors' },
          sourceRequest: null,
          firstCheckMinutes: null,
          maxGapHours: null,
          forHours: null,
          startsOn: 'merge',
          productionCheck: null,
        },
      ],
    },
    files: ['src/b.ts'],
  });
}

function reachReview(harness: Harness) {
  registerRepo(harness);
  const taskId = createTask(harness, { request: REQUEST });
  proposePlan(harness, taskId, {
    goal: 'Ship it.',
    phases: [
      { title: 'Find the overflow', detail: 'Trace which container scrolls.' },
      { title: 'Fix and verify', detail: 'Clamp the width.' },
    ],
    behaviour: ['It works.'],
    approach: 'Carefully.',
    files: [{ path: 'src/panel.ts', change: 'Clamp the width' }],
    outOfScope: [],
    verification: [{ label: 'Panel tests', command: 'bun test src/panel', phases: [1, 2] }],
    questions: [],
  });
  completeLastPhase(harness, taskId);
  harness.send({
    type: 'checks.record',
    taskId,
    results: PASSING.map((check) => ({ ...check, detail: 'secret output' })),
  });
  harness.send({
    type: 'agent.report_review',
    runId: harness.activeRun(taskId).id,
    summary: 'Looks right.',
    findings: [{ severity: 'optional', file: 'src/b.ts', line: 5, message: 'Rename it.' }],
  });
  return taskId;
}

function withPullRequest(task: Task, state: 'open' | 'merged' | 'closed'): Task {
  return {
    ...task,
    pullRequest: pullRequest({
      state,
      headSha: 'abc',
      mergeCommit: 'def',
      checkRuns: [{ name: 'test', status: 'success', required: true, url: 'https://github.com/run/1' }],
      unresolvedThreads: ['thread-1'],
    }),
  };
}

describe('what a shared task shows', () => {
  test('a public repository keeps the paths, the plan and the pull request, and never the private parts', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const task = withPullRequest(harness.task(taskId), 'open');
    const shared = resolveSharedTask(harness.state, task, PUBLIC);
    expect(shared).toMatchObject({
      project: 'Superwall',
      owner: 'mona',
      machine: 'Studio',
      repository: 'superwall/paywall-next',
      code: true,
    });
    expect(shared.task).toMatchObject({
      request: 'Fix the scroll in tab groups',
      worktreePath: null,
      repoId: null,
      projectId: null,
      origin: null,
      activity: [],
      waitsOn: [],
      planAnswers: null,
      updatedAt: task.stageChangedAt,
    });
    expect(shared.task.plan?.document?.files).toEqual([{ path: 'src/panel.ts', change: 'Clamp the width' }]);
    expect(shared.task.plan?.body).toContain('src/panel.ts');
    expect(shared.task.plan?.feedback).toBeNull();
    expect(shared.task.phaseReports.map((report) => report.files)).toEqual([['src/a.ts'], ['src/b.ts']]);
    expect(shared.task.phaseReports.every((report) => report.runId === null)).toBe(true);
    expect(shared.task.phaseReports[1]?.summary).toBe(
      'Clamped it in [panel.ts](shinsa://file/src/panel.ts#L3) after the other task and  too.'
    );
    const walkthrough = shared.task.phaseReports[1]?.walkthrough;
    expect(walkthrough?.watchdogs).toEqual([]);
    expect(walkthrough?.steps?.[0]?.command).toBe('bun run migrate');
    expect(walkthrough?.testing.manual.map((step) => step.target)).toEqual([
      { kind: 'url', value: 'https://app.example.dev' },
      null,
      null,
    ]);
    expect(shared.task.checkResults?.every((check) => check.detail === null)).toBe(true);
    expect(shared.task.checks?.[0]?.command).toBe('bun test src/panel');
    expect(shared.task.findings[0]).toMatchObject({ file: 'src/b.ts', line: 5, verdictNote: null });
    expect(shared.task.pullRequest).toMatchObject({
      url: 'https://github.com/superwall/paywall-next/pull/42',
      headSha: 'abc',
      unresolvedThreads: [],
    });
    expect(shared.task.pullRequest?.checkRuns?.[0]?.url).toBe('https://github.com/run/1');
  });

  test('a private repository drops every path, line, command and link, and shows no code', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const task = withPullRequest(harness.task(taskId), 'merged');
    const shared = resolveSharedTask(harness.state, task, PRIVATE);
    expect(shared).toMatchObject({ repository: null, code: false });
    expect(shared.task.plan?.document?.files).toEqual([]);
    expect(shared.task.plan?.document?.verification[0]?.command).toBe('');
    expect(shared.task.plan?.body).not.toContain('src/panel.ts');
    expect(shared.task.phaseReports.flatMap((report) => report.spots)).toEqual([
      { file: '', start: 0, end: 0, attention: 'critical', why: 'The change.', title: 'Clamp' },
      { file: '', start: 0, end: 0, attention: 'high', why: 'The other change.' },
    ]);
    expect(shared.task.phaseReports[0]?.judgementCalls[0]).toMatchObject({ file: null, line: null });
    expect(shared.task.phaseReports.map((report) => report.files)).toEqual([[], []]);
    expect(shared.task.phaseReports[1]?.summary).toBe(
      'Clamped it in panel.ts after the other task and  too.'
    );
    const walkthrough = shared.task.phaseReports[1]?.walkthrough;
    expect(walkthrough?.risks[0]).toMatchObject({ file: null, line: null, end: null });
    expect(walkthrough?.steps?.[0]?.command).toBeNull();
    expect(shared.task.report?.sections.flatMap((section) => section.spots.map((spot) => spot.file))).toEqual(
      shared.task.report?.sections.flatMap((section) => section.spots.map(() => '')) ?? []
    );
    expect(shared.task.report?.checks.every((check) => check.command === '' && check.detail === null)).toBe(
      true
    );
    expect(shared.task.report?.judgementCalls.every((call) => call.file === null)).toBe(true);
    expect(shared.task.report?.walkthrough?.risks.every((risk) => risk.file === null)).toBe(true);
    expect(shared.task.checks?.[0]?.command).toBe('');
    expect(shared.task.findings[0]).toMatchObject({ file: null, line: null, end: null });
    expect(shared.task.coverage).toBeNull();
    expect(shared.task.pullRequest).toMatchObject({ url: '', headSha: null, mergeCommit: null });
    expect(shared.task.pullRequest?.checkRuns?.[0]?.url).toBeNull();
    expect(shared.task.rounds?.[0]?.pullRequest).toBeNull();
    expect(shared.evidence.map((evidence) => evidence.title)).toEqual([
      'Shot of panel.ts',
      'Shot of panel.ts',
      'Panel tests',
    ]);
  });

  test('a repository of unknown visibility, or none, is treated as private', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const task = withPullRequest(harness.task(taskId), 'open');
    const unknown = resolveSharedTask(harness.state, task, UNKNOWN);
    const none = resolveSharedTask(harness.state, task, { ...PUBLIC, repository: null });
    for (const shared of [unknown, none]) {
      expect(shared).toMatchObject({ repository: null, code: false });
      expect(shared.task.plan?.document?.files).toEqual([]);
    }
  });

  test('evidence keeps stored files by id and public addresses, and drops local addresses', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const shared = resolveSharedTask(harness.state, harness.task(taskId), PUBLIC);
    expect(shared.evidence.map((evidence) => evidence.uri)).toEqual([
      `${SHARED_EVIDENCE_PREFIX}${shared.evidence[0]?.id}`,
      'https://preview.example.dev',
      'shinsa://check/c1',
    ]);
    expect(shared.evidence[0]).toMatchObject({
      runId: null,
      width: 900,
      theme: 'dark',
      title: 'Shot of [panel.ts](shinsa://file/src/panel.ts)',
      detail: 'See the task.',
    });
  });

  test('an uploaded copy of a file stands in for it', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const id = Object.values(harness.state.evidence).find(
      (piece) => piece.uri === 'http://localhost:5181/tasks'
    )?.id;
    harness.send({
      type: 'evidence.record_uploads',
      taskId,
      uploads: [{ evidenceId: id ?? '', url: 'https://github.com/user-attachments/1' }],
    });
    const shared = resolveSharedTask(harness.state, harness.task(taskId), PUBLIC);
    expect(shared.evidence.map((evidence) => evidence.uri)).toContain(
      'https://github.com/user-attachments/1'
    );
  });

  test('before a plan, only the general facts and the request are shown', () => {
    const harness = createHarness();
    registerRepo(harness);
    const taskId = createTask(harness, { request: REQUEST });
    const shared = resolveSharedTask(harness.state, harness.task(taskId), PUBLIC);
    expect(shared.task).toMatchObject({
      request: 'Fix the scroll in tab groups',
      plan: null,
      report: null,
      result: null,
      proposal: null,
      checkResults: null,
      phaseReports: [],
      findings: [],
    });
    expect(shared.evidence).toEqual([]);
    expect(shared.code).toBe(false);
  });

  test('an answer keeps its result without the run that wrote it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const task: Task = {
      ...harness.task(taskId),
      result: { step: 'answer', body: 'It clamps.', runId: 'run-1', at: 5 },
      proposal: { request: 'Clamp it', why: 'It overflows.', status: 'open', runId: 'run-1', at: 5 },
    };
    const shared = resolveSharedTask(harness.state, task, PUBLIC);
    expect(shared.task.result).toEqual({ step: 'answer', body: 'It clamps.', runId: null, at: 5 });
    expect(shared.task.proposal?.runId).toBeNull();
  });

  test('earlier rounds keep their pull request and merge steps only for a public repository', () => {
    const harness = createHarness();
    const base = harness.task(createTask(harness));
    const round = base.rounds?.[0];
    if (!round) throw new Error('no round');
    const task: Task = {
      ...base,
      rounds: [
        {
          ...round,
          request: REQUEST,
          base: 'main',
          pullRequest: { number: 7, url: 'https://github.com/o/r/pull/7', state: 'merged', base: 'main' },
        },
      ],
      carriedMergeSteps: [
        {
          when: 'post_merge',
          kind: 'deploy',
          title: 'Deploy',
          detail: 'Ship it.',
          command: 'wrangler deploy',
          round: 1,
          done: false,
        },
      ],
    };
    const open = resolveSharedTask(harness.state, task, PUBLIC).task;
    const closed = resolveSharedTask(harness.state, task, PRIVATE).task;
    expect(open.rounds?.[0]).toMatchObject({ request: 'Fix the scroll in tab groups', base: 'main' });
    expect(open.rounds?.[0]?.pullRequest).toMatchObject({
      url: 'https://github.com/o/r/pull/7',
      base: 'main',
    });
    expect(open.carriedMergeSteps?.[0]?.command).toBe('wrangler deploy');
    expect(closed.rounds?.[0]).toMatchObject({ base: null, pullRequest: { number: 7, url: '', base: null } });
    expect(closed.carriedMergeSteps?.[0]?.command).toBeNull();
  });

  test('a revised plan keeps its changes, but not how many files changed for a private repository', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const plan = harness.task(taskId).plan;
    if (!plan) throw new Error('no plan');
    const task: Task = {
      ...harness.task(taskId),
      plan: { ...plan, changes: [{ kind: 'goal' }, { kind: 'files', added: 1, removed: 0 }] },
    };
    expect(resolveSharedTask(harness.state, task, PUBLIC).task.plan?.changes).toHaveLength(2);
    expect(resolveSharedTask(harness.state, task, PRIVATE).task.plan?.changes).toEqual([{ kind: 'goal' }]);
  });

  test('a task with no project names none', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'What is the clamp?', repoId: null });
    const task = Object.values(harness.state.tasks)[0] as Task;
    expect(resolveSharedTask(harness.state, task, { ...PUBLIC, repository: null }).project).toBeNull();
  });
});

describe('when a shared task has code', () => {
  test('only a public repository with an open or merged pull request', () => {
    const harness = createHarness();
    const task = harness.task(createTask(harness));
    const repository = PUBLIC.repository;
    expect(hasSharedCode(task, repository)).toBe(false);
    expect(hasSharedCode(withPullRequest(task, 'open'), repository)).toBe(true);
    expect(hasSharedCode(withPullRequest(task, 'merged'), repository)).toBe(true);
    expect(hasSharedCode(withPullRequest(task, 'closed'), repository)).toBe(false);
    expect(hasSharedCode(withPullRequest(task, 'open'), PRIVATE.repository)).toBe(false);
    expect(hasSharedCode(withPullRequest(task, 'open'), null)).toBe(false);
  });
});

describe('the fingerprint of a shared task', () => {
  test('exists only while the task is shared, and ignores what the projection leaves out', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(resolveSharedFingerprint(harness.state, taskId)).toBeNull();
    expect(resolveSharedFingerprint(harness.state, 'missing')).toBeNull();
    harness.send({ type: 'task.share', taskId });
    expect(harness.task(taskId).share).toEqual({ at: harness.now, url: null });
    const before = resolveSharedFingerprint(harness.state, taskId);
    harness.send({ type: 'agent.note', runId: harness.activeRun(taskId).id, note: 'Private thought.' });
    expect(resolveSharedFingerprint(harness.state, taskId)).toBe(before);
    proposePlan(harness, taskId);
    expect(resolveSharedFingerprint(harness.state, taskId)).not.toBe(before);
  });
});
