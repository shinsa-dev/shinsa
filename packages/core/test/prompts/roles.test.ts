import { describe, expect, test } from 'bun:test';
import {
  REFERENCE_RULES,
  resolveAnswerPrompt,
  resolveContinuePrompt,
  resolvePhasePrompt,
  resolvePlannerPrompt,
  resolveReviewerPrompt,
} from '../../src/index.ts';
import { completePhase, createHarness, createTask, proposePlan, readyWorktree, SPEC } from '../harness.ts';

describe('agent prompts', () => {
  test('teach the reference syntax and link the task itself', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { intent: 'Ship the API' });
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
    const base = createTask(harness, { intent: 'Base work' });
    const other = createTask(harness, { intent: 'Other work' });
    const taskId = createTask(harness, { intent: 'Top work' });
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
    expect(resolvePhasePrompt({ ...task, spec: null }, null, [], 0)).toContain(
      'Your phase: build the whole change.'
    );
  });
});

describe('session prompts', () => {
  test('a restart asks the agent to carry on', () => {
    expect(resolveContinuePrompt()).toContain('Continue exactly where you left off');
  });

  test('an answer repeats the question', () => {
    expect(resolveAnswerPrompt('Which width?', '240')).toBe(
      'You asked the human: Which width?\n\nTheir answer: 240\n\nCarry on.'
    );
  });
});

describe('a later phase', () => {
  test('sees the plan, what is out of scope, and every earlier phase in order', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId, {
      ...SPEC,
      outOfScope: ['Mobile', 'Dark mode'],
      plan: [
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
