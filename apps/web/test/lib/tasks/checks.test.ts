import { describe, expect, it } from 'bun:test';
import type { CiRun, PhaseReport, ReportCheck, Task, TaskCheck } from '@shinsa/core';
import {
  CHECK_STATE_LABEL,
  type ChecksView,
  describeCheckPhases,
  listRunningCheckIds,
  resolveBaseBranch,
  resolveChecksView,
  resolveEvidenceCheckRow,
  resolveStatusState,
  selectCheckOutput,
} from '@/lib/tasks/checks.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createEvidence, createRepo, createShinsaState, createTask } from '../../support/state.ts';

const PLAN_DOCUMENT = {
  goal: '',
  phases: [
    { title: 'One', detail: '' },
    { title: 'Two', detail: '' },
    { title: 'Three', detail: '' },
  ],
  behaviour: [],
  approach: '',
  files: [],
  outOfScope: [],
  verification: [],
  questions: [],
};

const PLAN = { version: 1, body: '', document: PLAN_DOCUMENT, proposedAt: 0 };

const UNIT: TaskCheck = {
  id: 'c1',
  label: 'Unit',
  command: 'bun test a.test.ts',
  phases: [1, 2, 3],
  source: 'plan',
};
const TYPES: TaskCheck = {
  id: 'c2',
  label: 'Types',
  command: 'bun run check-types',
  phases: [2, 3],
  source: 'plan',
};
const DRY: TaskCheck = { id: 'c3', label: 'Dry run', command: 'bun dry.ts', phases: [3], source: 'agent' };

const REPO = createRepo({ id: 'repo', defaultBranch: 'main', checkCommands: ['bun run lint'] });

function reports(count: number): PhaseReport[] {
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    summary: '',
    spots: [],
    judgementCalls: [],
    at: index,
  }));
}

function result(check: Pick<TaskCheck, 'id' | 'label' | 'command'>, overrides: Partial<ReportCheck> = {}) {
  return {
    id: check.id,
    label: check.label,
    command: check.command,
    outcome: 'pass',
    detail: null,
    ...overrides,
  } as ReportCheck;
}

function task(overrides: Partial<Task> = {}) {
  return createTask({
    id: 't',
    repoId: 'repo',
    plan: PLAN,
    checks: [UNIT, TYPES, DRY],
    phaseReports: reports(3),
    ...overrides,
  });
}

function view(subject: Task, evidence = createShinsaState({ repos: [REPO] }).evidence) {
  return resolveChecksView({ repos: { repo: REPO }, evidence }, subject) as ChecksView;
}

function states(subject: Task) {
  return view(subject).stages.flatMap((stage) => stage.rows.map((row) => [row.key, row.state]));
}

describe('describeCheckPhases', () => {
  it('names one phase, a run of phases and phases with gaps', () => {
    expect(describeCheckPhases([2])).toBe('phase 2');
    expect(describeCheckPhases([3, 1, 2, 2])).toBe('phases 1 to 3');
    expect(describeCheckPhases([1, 3])).toBe('phases 1 and 3');
    expect(describeCheckPhases([1, 3, 5])).toBe('phases 1, 3 and 5');
    expect(describeCheckPhases([])).toBeNull();
  });
});

describe('the Building stage', () => {
  it('lists every task check with who added it, then the repository’s baseline, each with its latest result', () => {
    const subject = task({
      checkResults: [
        result(UNIT, { detail: '12 pass' }),
        result(TYPES, { outcome: 'fail', detail: 'TS2322' }),
        result({ id: 'r1', label: 'bun run lint', command: 'bun run lint' }, { outcome: 'skipped' }),
      ],
    });
    const checks = view(subject);
    expect(checks.stages.map((stage) => [stage.key, stage.title, stage.summary, stage.status])).toEqual([
      ['building', 'Building', '1 of 4 failed', 'failed'],
    ]);
    expect(checks.summary).toBe('2 of 3 checks passed');
    const rows = checks.stages[0]?.rows ?? [];
    expect(rows.map((row) => [row.id, row.state, row.meta, row.detail])).toEqual([
      ['c1', 'passed', 'From the plan · phases 1 to 3', null],
      ['c2', 'failed', 'From the plan · phases 2 to 3', 'TS2322'],
      ['c3', 'not_run', 'Added by the agent · phase 3', null],
      ['r1', 'skipped', 'Repository · before review', null],
    ]);
    expect([rows[3]?.label, rows[3]?.command, rows[0]?.command]).toEqual([
      'bun run lint',
      null,
      'bun test a.test.ts',
    ]);
  });

  it('leaves out the phases of a one-phase plan, and has no Building stage without checks', () => {
    const one = task({
      plan: { ...PLAN, document: { ...PLAN_DOCUMENT, phases: [{ title: 'One', detail: '' }] } },
    });
    expect(view(one).stages[0]?.rows[0]?.meta).toBe('From the plan');
    expect(resolveChecksView({ repos: {}, evidence: {} }, createTask({ id: 'q' }))).toBeNull();
    expect(
      resolveChecksView({ repos: {}, evidence: {} }, createTask({ id: 'q', checkResults: [result(UNIT)] }))
    ).toBeNull();
  });

  it('says a check passed when re-run alone, and that one already failing on the base does not block', () => {
    const subject = task({
      checkResults: [
        result(UNIT, { note: 'passed_alone' }),
        result(TYPES),
        result(DRY, { outcome: 'fail', detail: 'refused', note: 'fails_on_base' }),
        result({ id: 'r1', label: 'bun run lint', command: 'bun run lint' }),
      ],
    });
    const checks = view(subject);
    const rows = checks.stages[0]?.rows ?? [];
    expect(rows.map((row) => [row.state, row.note])).toEqual([
      ['passed_alone', 'Passed when re-run alone'],
      ['passed', null],
      ['fails_on_base', 'Already failing on main, so it does not block'],
      ['passed', null],
    ]);
    expect([checks.stages[0]?.summary, checks.summary, checks.status]).toEqual([
      'All 4 passed',
      'All 4 checks passed',
      'passed',
    ]);
  });

  it('says what has passed and what is left while the phases are still being built', () => {
    const checks = view(task({ phaseReports: reports(1), checkResults: [result(UNIT)] }));
    expect([checks.stages[0]?.summary, checks.summary, checks.status]).toEqual([
      '1 passed, 3 not run yet',
      '1 check passed, 3 not run yet',
      'partial',
    ]);
    const idle = view(task({ phaseReports: [] }));
    expect([idle.stages[0]?.summary, idle.summary, idle.status]).toEqual([
      'Not run yet',
      '4 checks, not run yet',
      'idle',
    ]);
  });

  it('names one check by itself', () => {
    const only = (results: ReportCheck[]) =>
      view(task({ checks: [UNIT], repoId: null, checkResults: results }));
    expect([only([result(UNIT)]).stages[0]?.summary, only([result(UNIT)]).summary]).toEqual([
      'Passed',
      'The check passed',
    ]);
    const failed = only([result(UNIT, { outcome: 'fail', detail: null })]);
    expect([failed.stages[0]?.summary, failed.summary]).toEqual(['Failed', 'The check failed']);
  });

  it('reads the latest output Shinsa attached for each check, never an agent’s piece', () => {
    const state = createShinsaState({
      evidence: [
        createEvidence({ id: 'old', taskId: 't', kind: 'check', checkId: 'c1', attachedAt: 1 }),
        createEvidence({ id: 'new', taskId: 't', kind: 'check', checkId: 'c1', attachedAt: 2 }),
        createEvidence({ id: 'link', taskId: 't', kind: 'test', checkId: 'c1', runId: 'run', attachedAt: 3 }),
        createEvidence({ id: 'other', taskId: 'u', kind: 'check', checkId: 'c1', attachedAt: 4 }),
        createEvidence({ id: 'plain', taskId: 't', kind: 'screenshot', attachedAt: 5 }),
      ],
    });
    expect(selectCheckOutput(state.evidence, 't', 'c1')?.id).toBe('new');
    expect(selectCheckOutput(state.evidence, 't', 'c2')).toBeNull();
    expect(view(task(), state.evidence).stages[0]?.rows[0]?.output?.id).toBe('new');
  });
});

describe('listRunningCheckIds', () => {
  it('runs nothing outside the checking stage, whatever is left over', () => {
    expect(listRunningCheckIds(task({ runningChecks: ['c1'] })).size).toBe(0);
    expect(listRunningCheckIds(task({ stage: 'checking' })).size).toBe(0);
  });

  it('marks exactly the checks of the run Shinsa started, and keeps the others’ results', () => {
    const subject = task({
      stage: 'checking',
      stageReason: 'running the checks again after the fix',
      runningChecks: ['c2', 'r1'],
      checkResults: [
        result(UNIT),
        result(TYPES, { outcome: 'fail' }),
        result(DRY, { outcome: 'fail', note: 'fails_on_base' }),
      ],
    });
    expect([...listRunningCheckIds(subject)]).toEqual(['c2', 'r1']);
    expect(states(subject)).toEqual([
      ['c1', 'passed'],
      ['c2', 'running'],
      ['c3', 'fails_on_base'],
      ['r1', 'running'],
    ]);
    expect(view(subject).summary).toBe('Running 2 checks');
    expect(view(subject).status).toBe('running');
    expect(view(subject).stages[0]?.rows[1]?.note).toBeNull();
  });
});

describe('the CI stage', () => {
  const RUNS: CiRun[] = [
    { name: 'build', status: 'success', required: true, url: 'https://ci/1' },
    { name: 'test', status: 'pending', required: false, url: null },
    { name: 'e2e', status: 'failure', required: null, url: null },
    { name: 'deploy', status: 'cancelled', required: null, url: null },
    { name: 'audit', status: 'action_required', required: null, url: null },
    { name: 'docs', status: 'skipped', required: null, url: null },
    { name: 'labels', status: 'neutral', required: null, url: null },
  ];

  it('lists the pull request’s CI checks after the Building stage, required or not, with their links', () => {
    const subject = task({
      checkResults: [result(UNIT), result(TYPES), result(DRY)],
      pullRequest: createPullRequest({ number: 4, checks: 'pending', checkRuns: RUNS }),
    });
    const checks = view(subject);
    const ci = checks.stages[1];
    expect([ci?.title, ci?.summary, ci?.status]).toEqual(['CI', 'Running 1 check', 'running']);
    expect(ci?.rows.map((row) => [row.label, row.state, row.meta, row.url, row.origin])).toEqual([
      ['build', 'passed', 'Required', 'https://ci/1', 'ci'],
      ['test', 'running', 'Optional', null, 'ci'],
      ['e2e', 'failed', 'CI', null, 'ci'],
      ['deploy', 'cancelled', 'CI', null, 'ci'],
      ['audit', 'action_required', 'CI', null, 'ci'],
      ['docs', 'skipped', 'CI', null, 'ci'],
      ['labels', 'neutral', 'CI', null, 'ci'],
    ]);
    expect([checks.status, checks.summary]).toEqual(['running', 'CI running']);
  });

  it('sums CI up from the pull request when it lists no runs, and leaves it out when there is no CI', () => {
    const only = (checks: 'passing' | 'failing' | 'pending' | 'none') =>
      resolveChecksView(
        { repos: {}, evidence: {} },
        createTask({ id: 'p', pullRequest: createPullRequest({ number: 1, checks }) })
      );
    expect(only('passing')?.stages.map((stage) => [stage.summary, stage.status])).toEqual([
      ['Passing', 'passed'],
    ]);
    expect(only('passing')?.summary).toBe('CI passing');
    expect(only('failing')?.summary).toBe('CI failing');
    expect(only('pending')?.stages[0]?.summary).toBe('Running');
    expect(only('none')).toBeNull();
    const failing = createTask({
      id: 'p',
      pullRequest: createPullRequest({ number: 1, checkRuns: [RUNS[2] as CiRun, RUNS[0] as CiRun] }),
    });
    expect(resolveChecksView({ repos: {}, evidence: {} }, failing)?.stages[0]?.summary).toBe('1 of 2 failed');
  });

  it('leads the summary with Building when both stages share its status', () => {
    const subject = task({
      checkResults: [
        result(UNIT),
        result(TYPES),
        result(DRY),
        result({ id: 'r1', label: 'l', command: 'bun run lint' }),
      ],
      pullRequest: createPullRequest({ number: 4, checkRuns: [RUNS[0] as CiRun] }),
    });
    expect(view(subject).summary).toBe('All 4 checks passed');
  });
});

describe('resolveBaseBranch', () => {
  it('is the pull request’s base or the repository’s default branch', () => {
    const state = { repos: { repo: REPO } };
    expect(
      resolveBaseBranch(state, task({ pullRequest: createPullRequest({ number: 1, base: 'next' }) }))
    ).toBe('next');
    expect(resolveBaseBranch(state, task())).toBe('main');
    expect(resolveBaseBranch(state, task({ repoId: null }))).toBeNull();
    const subject = task({
      repoId: null,
      checkResults: [result(UNIT, { outcome: 'fail', note: 'fails_on_base' })],
    });
    expect(view(subject).stages[0]?.rows[0]?.note).toBe(
      'Already failing on the base branch, so it does not block'
    );
  });
});

describe('resolveEvidenceCheckRow', () => {
  const output = createEvidence({ id: 'out', taskId: 't', kind: 'check', checkId: 'c1' });

  it('is the check’s row with the round’s output, or a row for a check the task no longer has', () => {
    const checks = view(task({ checkResults: [result(UNIT)] }));
    const row = resolveEvidenceCheckRow(checks, { id: 'c1', output: null }, 'Unit');
    expect([row.label, row.state, row.output]).toEqual(['Unit', 'passed', null]);
    const round = resolveEvidenceCheckRow(
      checks,
      {
        id: 'c1',
        output: { evidence: output, media: 'text', facts: '', fromReview: false, updated: null, image: null },
      },
      'Unit'
    );
    expect(round.output?.id).toBe('out');
    const gone = resolveEvidenceCheckRow(null, { id: 'c9', output: null }, 'Old tests');
    expect([gone.label, gone.state, gone.meta, gone.command]).toEqual([
      'Old tests',
      'not_run',
      'No longer one of the task’s checks',
      null,
    ]);
  });
});

describe('the glyphs', () => {
  it('names every state and turns a stage’s status into the state its glyph shows', () => {
    expect(CHECK_STATE_LABEL.not_run).toBe('Not run yet');
    expect(
      (['running', 'failed', 'passed', 'partial', 'idle'] as const).map((status) =>
        resolveStatusState(status)
      )
    ).toEqual(['running', 'failed', 'passed', 'passed', 'not_run']);
  });
});
