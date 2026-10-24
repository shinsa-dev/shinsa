import { describe, expect, test } from 'bun:test';
import { resolveCurrentRound } from '../../src/index.ts';
import {
  REFERENCE_RULES,
  resolveAnswererPrompt,
  resolvePhasePrompt,
  resolvePlannerPrompt,
  resolveReviewerPrompt,
} from '../../src/prompts/index.ts';
import {
  completePhase,
  createHarness,
  createTask,
  PLAN,
  proposePlan,
  pullRequest,
  reachShipping,
  readyWorktree,
  shipAndMerge,
} from '../harness.ts';

describe('agent prompts', () => {
  test('teach the reference syntax and link the task itself', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Ship the API' });
    readyWorktree(harness, taskId);
    const planner = harness.activeRun(taskId).prompt ?? '';
    expect(planner).toContain(REFERENCE_RULES);
    expect(planner).toContain(`(shinsa://task/${taskId})`);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId).prompt ?? '';
    expect(builder).toContain('shinsa://pr/<repository>#4531');
    expect(builder).toContain(`(shinsa://task/${taskId})`);
  });
});

describe('what a prompt says about the work it builds on', () => {
  function tasks() {
    const harness = createHarness();
    const base = createTask(harness, { request: 'Base work' });
    const other = createTask(harness, { request: 'Other work' });
    const taskId = createTask(harness, { request: 'Top work' });
    proposePlan(harness, taskId);
    return { harness, base: harness.task(base), other: harness.task(other), task: harness.task(taskId) };
  }

  test('a merged task is in the base branch now', () => {
    const { harness, base, task } = tasks();
    const repo = harness.state.repos[task.repoId ?? ''] ?? null;
    const prompt = resolvePlannerPrompt(task, repo, [{ ...base, stage: 'merged' }], null);
    expect(prompt).toContain(
      'This task builds on "Base work", which has merged. Its work is in the base branch now.'
    );
  });

  test('a task marked done left its work in the base branch', () => {
    const { base, task } = tasks();
    expect(resolvePlannerPrompt(task, null, [{ ...base, stage: 'done' }], null)).toContain(
      'This task builds on "Base work", which is finished. Build on what it left in the base branch.'
    );
  });

  test('several finished tasks are named together', () => {
    const { base, other, task } = tasks();
    const bases = [
      { ...base, stage: 'merged' as const },
      { ...other, stage: 'done' as const },
    ];
    expect(resolvePhasePrompt(task, null, bases, 0)).toContain(
      'This task builds on "Base work" and "Other work", which are all finished.'
    );
    const third = { ...other, id: 'third', title: 'Third work', stage: 'done' as const };
    expect(resolvePhasePrompt(task, null, [...bases, third], 0)).toContain(
      'This task builds on "Base work", "Other work" and "Third work", which are all finished.'
    );
  });

  test('a stacked task starts from the unmerged branch, and its review diffs against it', () => {
    const { base, task } = tasks();
    const prompt = resolvePhasePrompt(task, null, [base], 0);
    expect(prompt).toContain(`not merged yet: "Base work" (branch ${base.branch})`);
    expect(resolveReviewerPrompt(task, null, [base])).toContain(
      `This task is stacked on ${base.branch}. Diff against that branch`
    );
    expect(resolveReviewerPrompt(task, null, [])).toContain('Diff the branch against the default branch');
  });

  test('without a repository the builder is told to find the checks itself', () => {
    const { task } = tasks();
    expect(resolvePhasePrompt(task, null, [], 0)).toContain('Run whatever lint, type check and tests');
    expect(resolvePhasePrompt(task, null, [], 1)).toContain('This is the last phase');
    expect(resolvePhasePrompt(task, null, [], 0)).toContain('Later phases build on yours');
  });

  test('a phase prompt without a plan asks for the whole change', () => {
    const { task } = tasks();
    expect(resolvePhasePrompt({ ...task, plan: null }, null, [], 0)).toContain(
      'Your phase: build the whole change.'
    );
  });
});

describe('a later phase', () => {
  test('sees the plan, what is out of scope, and every earlier phase in order', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId, {
      ...PLAN,
      outOfScope: ['Mobile', 'Dark mode'],
      phases: [
        { title: 'One', detail: 'First.' },
        { title: 'Two', detail: 'Second.' },
        { title: 'Three', detail: 'Third.' },
      ],
    });
    completePhase(harness, taskId, 'Did one.');
    completePhase(harness, taskId, 'Did two.');
    const task = harness.task(taskId);
    const prompt = resolvePhasePrompt(
      { ...task, phaseReports: [...task.phaseReports].reverse() },
      null,
      [],
      2
    );
    expect(prompt).toContain('Out of scope: Mobile; Dark mode');
    expect(prompt).toContain('The plan:\n1. One: First.\n2. Two: Second.\n3. Three: Third.');
    expect(prompt).toContain(
      'Already done by earlier phases (their changes are in your worktree):\n- One: Did one.\n- Two: Did two.'
    );
    expect(prompt).toContain('Your phase: Three. Third.');
  });
});

describe('the answerer prompt', () => {
  test('works without a repository and says nothing about a checkout', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const prompt = resolveAnswererPrompt(harness.task(taskId), null, null);
    expect(prompt).toContain('Your role: answerer.');
    expect(prompt).not.toContain('checked out at');
    expect(prompt).not.toContain('followed up');
  });
});

describe('reading another task', () => {
  test('every step agent is told to read another task with read_task, which never changes it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId).prompt ?? '';
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId).prompt ?? '';
    const answerer = resolveAnswererPrompt(harness.task(taskId), null, null);
    for (const prompt of [planner, builder, answerer]) {
      expect(prompt).toContain(
        'call `read_task` with an id from `find_tasks`. It reads; it never changes the task.'
      );
    }
  });
});

describe('a later round’s reviewer', () => {
  test('is told to review the commits made since the round started', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    shipAndMerge(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Add a CSV option', kind: 'new_round', title: 'CSV' });
    const task = harness.task(taskId);
    const round = resolveCurrentRound(task);
    const prompt = resolveReviewerPrompt(task, null, []);
    expect(round.number).toBe(2);
    expect(prompt).toContain(
      `Review only this round's commits, the ones made since it started (\`git log --since=${new Date(round.startedAt ?? 0).toISOString()}\`)`
    );
    expect(prompt).not.toContain('named after its phases');
  });
});

describe('a later round’s planner', () => {
  test('with an open pull request is not offered an inquiry shape it cannot take', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    readyWorktree(harness, taskId);
    const fresh = harness.activeRun(taskId).prompt ?? '';
    expect(fresh).toContain('- `shape` when the request needs no change at all');
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    harness.send({ type: 'task.message', taskId, text: 'Add a CSV option', kind: 'new_round', title: 'CSV' });
    readyWorktree(harness, taskId);
    const planner = harness.activeRun(taskId);
    expect(planner.role).toBe('planner');
    expect(planner.prompt).toContain(
      'An earlier round of this task has an open pull request, so this round ships through it'
    );
    expect(planner.prompt).not.toContain('- `shape` when the request needs no change at all');
  });
});
