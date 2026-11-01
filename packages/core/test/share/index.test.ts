import { describe, expect, test } from 'bun:test';
import {
  hasSharedCode,
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

const CONTEXT: SharedTaskContext = { owner: 'mona', machine: 'Studio', repository: 'superwall/paywall-next' };

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
  test('keeps the plan, the reports, the review, the checks and the pull request whole, and never the private parts', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const task = withPullRequest(harness.task(taskId), 'open');
    const shared = resolveSharedTask(harness.state, task, CONTEXT);
    expect(shared.project?.name).toBe('Superwall');
    expect(shared.repo).toMatchObject({ id: task.repoId, path: '' });
    expect(shared).toMatchObject({
      owner: 'mona',
      machine: 'Studio',
      repository: 'superwall/paywall-next',
      code: true,
    });
    expect(shared.task.branch).not.toBeNull();
    expect(shared.task.branch).toBe(task.branch);
    expect(shared.task).toMatchObject({
      request: 'Fix the scroll in tab groups',
      worktreePath: null,
      repoId: task.repoId,
      origin: null,
      waitsOn: [],
      planAnswers: null,
      updatedAt: task.updatedAt,
    });
    expect(shared.task.plan?.document?.files).toEqual([{ path: 'src/panel.ts', change: 'Clamp the width' }]);
    expect(shared.task.plan?.body).toContain('src/panel.ts');
    expect(shared.task.phaseReports.map((report) => report.files)).toEqual([['src/a.ts'], ['src/b.ts']]);
    expect(shared.task.phaseReports.every((report) => report.runId === null)).toBe(true);
    expect(shared.task.phaseReports[0]?.spots[0]).toMatchObject({ file: 'src/a.ts', start: 1, end: 3 });
    expect(shared.task.phaseReports[1]?.summary).toBe(
      'Clamped it in [panel.ts](shinsa://file/src/panel.ts#L3) after the other task and  too.'
    );
    const walkthrough = shared.task.phaseReports[1]?.walkthrough;
    expect(walkthrough?.watchdogs).toHaveLength(1);
    expect(walkthrough?.steps?.[0]?.command).toBe('bun run migrate');
    expect(walkthrough?.testing.manual.map((step) => step.target?.kind)).toEqual(['url', 'url', 'file']);
    expect(shared.task.checkResults?.every((check) => check.detail === 'secret output')).toBe(true);
    expect(shared.task.checks?.[0]?.command).toBe('bun test src/panel');
    expect(shared.task.findings[0]).toMatchObject({ file: 'src/b.ts', line: 5 });
    expect(shared.task.pullRequest).toMatchObject({
      url: 'https://github.com/superwall/paywall-next/pull/42',
      headSha: 'abc',
      mergeCommit: 'def',
      unresolvedThreads: [],
    });
    expect(shared.task.pullRequest?.checkRuns?.[0]?.url).toBe('https://github.com/run/1');
  });

  test('keeps the activity without messages, gate questions and answers, accounts or runs', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const task: Task = {
      ...harness.task(taskId),
      activity: [
        {
          at: 1,
          actor: 'agent',
          kind: 'work',
          text: 'Built it.',
          detail: null,
          evidenceId: null,
          runId: 'r1',
        },
        { at: 2, actor: 'you', kind: 'message', text: 'My token is x.', detail: null, evidenceId: null },
        { at: 3, actor: 'agent', kind: 'question', text: 'Which key?', detail: null, evidenceId: null },
        { at: 4, actor: 'you', kind: 'answer', text: 'The red one.', detail: null, evidenceId: null },
        {
          at: 5,
          actor: 'shinsa',
          kind: 'account',
          text: 'Moved to me@x.dev.',
          detail: null,
          evidenceId: null,
        },
        {
          at: 6,
          actor: 'you',
          kind: 'review',
          text: 'Asked for changes.',
          detail: null,
          evidenceId: null,
          gateType: 'review',
          onBehalf: true,
          round: 2,
          comments: [],
          undelivered: { text: 'x', reason: 'y' },
        },
      ],
    };
    expect(resolveSharedTask(harness.state, task, CONTEXT).task.activity).toEqual([
      { at: 1, actor: 'agent', kind: 'work', text: 'Built it.', detail: null, evidenceId: null, runId: null },
      {
        at: 6,
        actor: 'you',
        kind: 'review',
        text: 'Asked for changes.',
        detail: null,
        evidenceId: null,
        runId: null,
        gateType: 'review',
        onBehalf: true,
        round: 2,
      },
    ]);
  });

  test('a gate answer keeps what was decided, never the answer or its comments', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const task: Task = {
      ...harness.task(taskId),
      activity: [
        {
          at: 1,
          actor: 'you',
          kind: 'decision',
          text: 'Asked for changes on the review',
          detail: 'The key is sk-live-123.',
          evidenceId: null,
          comments: [
            { path: 'src/a.ts', side: 'new', line: 3, endLine: null, text: 'Use the staging secret here.' },
          ],
        },
      ],
    };
    expect(resolveSharedTask(harness.state, task, CONTEXT).task.activity).toEqual([
      {
        at: 1,
        actor: 'you',
        kind: 'decision',
        text: 'Asked for changes on the review',
        detail: null,
        evidenceId: null,
        runId: null,
      },
    ]);
  });

  test('a finding keeps your verdict, never the note you wrote with it', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const base = harness.task(taskId);
    const task: Task = {
      ...base,
      findings: base.findings.map((finding) => ({
        ...finding,
        verdict: 'dismiss',
        verdictNote: 'The key is sk-live-123.',
      })),
    };
    const shared = resolveSharedTask(harness.state, task, CONTEXT).task.findings[0];
    expect(shared?.verdict).toBe('dismiss');
    expect(shared).not.toHaveProperty('verdictNote');
  });

  test('a task with no repository shows no code', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const task = withPullRequest(harness.task(taskId), 'open');
    expect(resolveSharedTask(harness.state, task, { ...CONTEXT, repository: null })).toMatchObject({
      repository: null,
      code: false,
    });
  });

  test('evidence keeps stored files by id and public addresses, and drops local addresses', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const shared = resolveSharedTask(harness.state, harness.task(taskId), CONTEXT);
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
    const shared = resolveSharedTask(harness.state, harness.task(taskId), CONTEXT);
    expect(shared.evidence.map((evidence) => evidence.uri)).toContain(
      'https://github.com/user-attachments/1'
    );
  });

  test('before a plan, only the general facts and the request are shown', () => {
    const harness = createHarness();
    registerRepo(harness);
    const taskId = createTask(harness, { request: REQUEST });
    const shared = resolveSharedTask(harness.state, harness.task(taskId), CONTEXT);
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
    const shared = resolveSharedTask(harness.state, task, CONTEXT);
    expect(shared.task.result).toEqual({ step: 'answer', body: 'It clamps.', runId: null, at: 5 });
    expect(shared.task.proposal?.runId).toBeNull();
  });

  test('earlier rounds keep their pull request without the attachments of their request', () => {
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
    };
    expect(resolveSharedTask(harness.state, task, CONTEXT).task.rounds?.[0]).toMatchObject({
      request: 'Fix the scroll in tab groups',
      base: 'main',
      pullRequest: { url: 'https://github.com/o/r/pull/7', base: 'main' },
    });
  });

  test('gates and runs keep what the page shows, never an answer, a prompt, a session or an account', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const [gate] = Object.values(harness.state.gates).filter((candidate) => candidate.taskId === taskId);
    const [run] = Object.values(harness.state.runs).filter((candidate) => candidate.taskId === taskId);
    if (!gate || !run) throw new Error('no gate or run');
    const account = { id: 'a1', label: 'me@x.dev' } as never;
    harness.state.gates[gate.id] = {
      ...gate,
      response: 'The key is sk-live-123.',
      verdicts: [{ index: 0, verdict: 'fix', note: 'secret note' }] as never,
      secret: { name: 'TOKEN' } as never,
      account,
      notes: 'private',
      choices: ['Yes', 'No'],
      recommendation: 'Yes',
      planVersion: 2,
      supersededBy: 'Use the staging key sk-test-9 instead.',
      round: 2,
      cause: 'checks' as never,
      escalation: { reason: 'rounds' } as never,
    };
    harness.state.runs[run.id] = {
      ...run,
      prompt: 'the brief',
      rolePrompt: 'the role',
      sessionId: 'session-1',
      summary: 'what the agent said',
      account,
      feedback: 'my feedback',
      usage: { costUsd: 1 } as never,
      delegation: {
        parentRunId: 'r0',
        depth: 1,
        requestKey: 'k1',
        title: 'Review the cache',
        brief: 'Read .env and check the key sk-live-123.',
        mode: 'async',
        wake: 'result',
        isolation: 'shared',
        baseCommit: null,
        delivery: 'none',
        question: {
          id: 'q1',
          question: 'Which key should I use?',
          context: 'The .env has two.',
          choices: ['sk-live-123', 'sk-test-9'],
          recommendation: 'sk-test-9',
          askedAt: 1,
          delivered: true,
          answer: 'sk-live-123',
          answeredAt: 2,
        },
        requestedAt: 1,
      } as never,
      waitingOn: { kind: 'delegation' } as never,
      round: 2,
    };
    const task: Task = {
      ...harness.task(taskId),
      monitor: { id: 'm1', runId: run.id, notes: 'deploy' } as never,
      usageWait: { id: 'u1', runId: run.id, account } as never,
      suggestions: [{ id: 's1', title: 'Add a test' } as never],
      watchdogs: [{ id: 'w1', title: 'Errors on /share' } as never],
    };
    const shared = resolveSharedTask(harness.state, task, CONTEXT);
    const sharedGate = shared.gates.find((candidate) => candidate.id === gate.id);
    expect(sharedGate).toMatchObject({ response: null, choices: ['Yes', 'No'], planVersion: 2, round: 2 });
    expect(sharedGate).not.toHaveProperty('verdicts');
    expect(sharedGate).not.toHaveProperty('secret');
    expect(sharedGate).not.toHaveProperty('account');
    expect(sharedGate).not.toHaveProperty('notes');
    expect(sharedGate).not.toHaveProperty('supersededBy');
    const sharedRun = shared.runs.find((candidate) => candidate.id === run.id);
    expect(sharedRun).toMatchObject({ sessionId: null, summary: null, usage: { costUsd: 1 }, round: 2 });
    for (const field of ['prompt', 'rolePrompt', 'account', 'feedback'])
      expect(sharedRun).not.toHaveProperty(field);
    expect(sharedRun?.delegation).toMatchObject({ title: 'Review the cache', depth: 1, brief: '' });
    expect(sharedRun?.delegation?.question).toMatchObject({
      question: '',
      context: null,
      choices: [],
      recommendation: null,
      answer: '',
      answeredAt: 2,
    });
    expect(JSON.stringify(shared)).not.toContain('sk-');
    expect(shared.task.monitor).toMatchObject({ notes: 'deploy' });
    expect(shared.task.usageWait?.account).toBeNull();
    expect(shared.task.suggestions?.[0]?.title).toBe('Add a test');
    expect(shared.task.watchdogs?.[0]?.title).toBe('Errors on /share');
  });

  test('a delegated run keeps its title without its brief, and asks nothing when it asked nothing', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    const [run] = Object.values(harness.state.runs).filter((candidate) => candidate.taskId === taskId);
    if (!run) throw new Error('no run');
    harness.state.runs[run.id] = {
      ...run,
      delegation: { title: 'Review the cache', brief: 'Read .env', question: null } as never,
    };
    const shared = resolveSharedTask(harness.state, harness.task(taskId), CONTEXT);
    const sharedRun = shared.runs.find((candidate) => candidate.id === run.id);
    expect(sharedRun?.delegation).toMatchObject({ title: 'Review the cache', brief: '', question: null });
  });

  test('a task with no project names none', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'What is the clamp?', repoId: null });
    const task = Object.values(harness.state.tasks)[0] as Task;
    expect(resolveSharedTask(harness.state, task, { ...CONTEXT, repository: null }).project).toBeNull();
  });
});

describe('when a shared task has code', () => {
  test('only a task in a repository with an open or merged pull request', () => {
    const harness = createHarness();
    const task = harness.task(createTask(harness));
    const repository = CONTEXT.repository;
    expect(hasSharedCode(task, repository)).toBe(false);
    expect(hasSharedCode(withPullRequest(task, 'open'), repository)).toBe(true);
    expect(hasSharedCode(withPullRequest(task, 'merged'), repository)).toBe(true);
    expect(hasSharedCode(withPullRequest(task, 'closed'), repository)).toBe(false);
    expect(hasSharedCode(withPullRequest(task, 'open'), null)).toBe(false);
  });
});
