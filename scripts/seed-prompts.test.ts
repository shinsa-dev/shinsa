import { describe, expect, it } from 'bun:test';
import type { PlanDocument, Repo, Run, RunPurpose, ShinsaEventInput } from '../packages/core/src/index.ts';
import { resolveHouseRules } from '../packages/core/src/index.ts';
import type { TimedSeedEvent } from './seed-kit.ts';
import { listRunOpenings, resolveRunOpening, stampRunPrompts } from './seed-prompts.ts';

const TASK = 'task-seed-prompts';

const REPO: Repo = {
  id: 'repo-seed-prompts',
  name: 'paywall-next',
  path: '/tmp/paywall-next',
  defaultBranch: 'main',
  remote: 'git@github.com:superwall/paywall-next.git',
  projectId: null,
  checkCommands: ['bunx knip'],
};

const PLAN: PlanDocument = {
  goal: 'Export chunks retry on timeouts.',
  phases: [
    { title: 'Wrap the write', detail: 'Retry each chunk write three times.' },
    { title: 'Cover it with tests', detail: 'One test per error kind.' },
  ],
  behaviour: [],
  approach: 'A small retry helper.',
  files: [],
  outOfScope: [],
  verification: [{ label: 'Chunk retries', command: 'bun test src/export', phases: [1, 2] }],
  questions: [],
};

function createRun(id: string, purpose: RunPurpose | null, extra: Partial<Run> = {}): Run {
  return {
    id,
    taskId: TASK,
    role: purpose ? 'agent' : 'reviewer',
    ...(purpose ? { purpose } : {}),
    provider: 'claude',
    model: 'claude-opus-5-5',
    sessionId: 'session-seed-prompts',
    startedAt: 0,
    endedAt: null,
    outcome: null,
    summary: null,
    ...extra,
  };
}

function listEvents(): ShinsaEventInput[] {
  return [
    { type: 'repo.registered', repo: REPO },
    {
      type: 'task.created',
      taskId: TASK,
      request: 'Retry export chunks on timeouts',
      repoId: REPO.id,
      priority: 'normal',
      planFirst: false,
      origin: null,
      auto: { shape: false, start: false, priority: false },
    },
    {
      type: 'task.triaged',
      taskId: TASK,
      title: 'Retry export chunks',
      repoId: REPO.id,
      size: 'small',
      branch: 'fix/export-retry',
      decisions: { shape: null, start: null, priority: null },
    },
    { type: 'run.started', run: createRun('plan', 'plan') },
    { type: 'plan.proposed', taskId: TASK, body: PLAN.goal, document: PLAN },
    { type: 'run.started', run: createRun('build', 'build', { phaseIndex: 1, resume: true }) },
    { type: 'fix.started', taskId: TASK, round: 1, reason: 'checks' },
    { type: 'run.started', run: createRun('fix-unchecked', 'fix', { resume: true }) },
    {
      type: 'checks.recorded',
      taskId: TASK,
      results: [
        {
          id: 'r1',
          label: 'bunx knip',
          command: 'bunx knip',
          outcome: 'fail',
          detail: 'Unused export SpotKey',
        },
      ],
    },
    { type: 'run.started', run: createRun('fix-checks', 'fix', { resume: true }) },
    { type: 'run.started', run: createRun('review', null) },
    {
      type: 'review.reported',
      taskId: TASK,
      summary: null,
      findings: [{ severity: 'blocking', file: null, line: null, message: 'Retries a 400 too.' }],
    },
    { type: 'fix.started', taskId: TASK, round: 2, reason: 'review' },
    { type: 'run.started', run: createRun('fix-review', 'fix', { resume: true }) },
    {
      type: 'gate.opened',
      gate: {
        id: 'gate-review',
        taskId: TASK,
        type: 'review',
        status: 'open',
        title: 'Review the retries',
        body: 'Ready.',
        runId: null,
        openedAt: 0,
        answeredAt: null,
        decision: null,
        response: null,
      },
    },
    { type: 'gate.answered', gateId: 'gate-unknown', decision: 'revise', response: 'Ignored.' },
    { type: 'gate.answered', gateId: 'gate-review', decision: 'revise', response: 'Log each attempt.' },
    { type: 'gate.answered', gateId: 'gate-review', decision: 'revise', response: null },
    { type: 'fix.started', taskId: TASK, round: 0, reason: 'you' },
    { type: 'run.started', run: createRun('fix-you', 'fix', { resume: true }) },
    { type: 'fix.started', taskId: TASK, round: 3, reason: 'pull_request' },
    { type: 'run.started', run: createRun('fix-early-pull-request', 'fix', { resume: true }) },
    {
      type: 'pull_request.opened',
      taskId: TASK,
      pullRequest: {
        number: 4602,
        url: 'https://github.com/superwall/paywall-next/pull/4602',
        state: 'open',
        checks: 'failing',
        unresolvedComments: 1,
        mergeable: true,
        updatedAt: 0,
      },
    },
    { type: 'run.started', run: createRun('operate', 'operate', { resume: true }) },
    { type: 'run.started', run: createRun('given', 'fix', { prompt: 'Already written.' }) },
  ];
}

function stamp(events: ShinsaEventInput[]) {
  const timeline: TimedSeedEvent[] = events.map((event, index) => ({ at: index * 1000, event }));
  return stampRunPrompts(timeline);
}

function listPrompts(timeline: TimedSeedEvent[]) {
  const prompts = new Map<string, string | undefined>();
  for (const { event } of timeline) {
    if (event.type === 'run.started') prompts.set(event.run.id, event.run.prompt);
  }
  return prompts;
}

describe('stampRunPrompts', () => {
  const timeline = stamp(listEvents());
  const prompts = listPrompts(timeline);

  it('briefs the planning run with the full planning prompt', () => {
    expect(prompts.get('plan')).toContain(
      'Your role: the agent for this task, in one conversation across all of its rounds. You plan this round'
    );
    expect(prompts.get('plan')?.startsWith(resolveHouseRules('agent'))).toBe(true);
  });

  it('gives each later agent run its short instruction', () => {
    expect(prompts.get('build')).toContain('Now build phase 2 of 2: Cover it with tests.');
    expect(prompts.get('fix-unchecked')).toContain('`bun test src/index.test.ts` failed');
    expect(prompts.get('fix-checks')).toContain('`bunx knip` failed');
    expect(prompts.get('fix-review')).toContain('The agent review found problems.');
    expect(prompts.get('fix-review')).toContain('Retries a 400 too.');
    expect(prompts.get('fix-you')).toContain('The human looked at the work and wrote:\n\nLog each attempt.');
    expect(prompts.get('fix-early-pull-request')).toContain('Pull request #4602 needs work');
    expect(prompts.get('operate')).toContain('Now run the operation in the plan');
  });

  it('leaves other roles and written prompts alone', () => {
    expect(prompts.get('review')).toBeUndefined();
    expect(prompts.get('given')).toBe('Already written.');
  });

  it('refuses a run that starts before its task', () => {
    expect(() => stamp([{ type: 'run.started', run: createRun('orphan', 'plan') }])).toThrow(
      'The seed starts run orphan before its task.'
    );
  });

  it('opens a resumed run with its instruction and a fresh one with the whole prompt', () => {
    const openings = listRunOpenings(timeline);
    expect(openings.get('plan')).toBe(prompts.get('plan'));
    expect(openings.get('build')?.startsWith('Phase 1 is committed.')).toBe(true);
    expect(openings.get('given')).toBe('Already written.');
    expect(openings.has('review')).toBe(false);
  });
});

describe('resolveRunOpening', () => {
  it('reads nothing from a run without a prompt', () => {
    expect(resolveRunOpening({})).toBeNull();
  });

  it('keeps a resumed prompt without house rules as it is', () => {
    expect(resolveRunOpening({ prompt: 'Carry on.', resume: true })).toBe('Carry on.');
  });
});
