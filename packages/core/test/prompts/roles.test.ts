import { describe, expect, test } from 'bun:test';
import { resolveCurrentRound } from '../../src/index.ts';
import {
  REFERENCE_RULES,
  resolveAnswererPrompt,
  resolveOperationInstruction,
  resolvePhaseInstruction,
  resolvePlanningPrompt,
  resolveReviewerPrompt,
  resolveRunBrief,
} from '../../src/prompts/index.ts';
import { describeRound } from '../../src/prompts/roles.ts';
import {
  completePhase,
  createHarness,
  createTask,
  linkSession,
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
    linkSession(harness, taskId);
    proposePlan(harness, taskId);
    const building = harness.activeRun(taskId);
    expect(building.prompt).toContain('shinsa://pr/<repository>#4531');
    expect(building.prompt).not.toContain(`(shinsa://task/${taskId})`);
    expect(resolveRunBrief(harness.state, building)).toContain(`(shinsa://task/${taskId})`);
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
    const prompt = resolvePlanningPrompt(task, repo, [{ ...base, stage: 'merged' }], null);
    expect(prompt).toContain(
      'This task builds on "Base work", which has merged. Its work is in the base branch now.'
    );
  });

  test('a task marked done left its work in the base branch', () => {
    const { base, task } = tasks();
    expect(resolvePlanningPrompt(task, null, [{ ...base, stage: 'done' }], null)).toContain(
      'This task builds on "Base work", which is finished. Build on what it left in the base branch.'
    );
  });

  test('several finished tasks are named together', () => {
    const { base, other, task } = tasks();
    const bases = [
      { ...base, stage: 'merged' as const },
      { ...other, stage: 'done' as const },
    ];
    expect(describeRound(task, null, bases, 0)).toContain(
      'This task builds on "Base work" and "Other work", which are all finished.'
    );
    const third = { ...other, id: 'third', title: 'Third work', stage: 'done' as const };
    expect(describeRound(task, null, [...bases, third], 0)).toContain(
      'This task builds on "Base work", "Other work" and "Third work", which are all finished.'
    );
  });

  test('a stacked task starts from the unmerged branch, and its review diffs against it', () => {
    const { base, task } = tasks();
    const prompt = describeRound(task, null, [base], 0);
    expect(prompt).toContain(`not merged yet: "Base work" (branch ${base.branch})`);
    expect(resolveReviewerPrompt(task, null, [base])).toContain(
      `This task is stacked on ${base.branch}. Diff against that branch`
    );
    expect(resolveReviewerPrompt(task, null, [])).toContain('Diff the branch against the default branch');
  });

  test('without a repository the agent is told to find the checks itself', () => {
    const { task } = tasks();
    expect(resolvePhaseInstruction(task, null, 0)).toContain('Run whatever lint, type check and tests');
    expect(resolvePhaseInstruction(task, null, 1)).toContain('This is the last phase');
    expect(resolvePhaseInstruction(task, null, 0)).toContain('Later phases build on this one');
  });

  test('a phase without a plan asks for the whole change', () => {
    const { task } = tasks();
    expect(resolvePhaseInstruction({ ...task, plan: null }, null, 0)).toContain(
      'Now build the whole change.'
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
    const brief = describeRound({ ...task, phaseReports: [...task.phaseReports].reverse() }, null, [], 2);
    expect(brief).toContain('Out of scope: Mobile; Dark mode');
    expect(brief).toContain('The plan:\n1. One: First.\n2. Two: Second.\n3. Three: Third.');
    expect(brief).toContain(
      'Already done by earlier phases (their changes are in your worktree):\n- One: Did one.\n- Two: Did two.'
    );
    const instruction = resolvePhaseInstruction(task, null, 2);
    expect(instruction).toContain('Phase 2 is committed.\nNow build phase 3 of 3: Three. Third.');
    expect(instruction).not.toContain('The plan:');
  });
});

describe('the round agent’s session', () => {
  test('plans once with the whole brief, then gets each phase as a short instruction on the same session', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Ship the API' });
    readyWorktree(harness, taskId);
    const planning = harness.activeRun(taskId);
    expect(planning.prompt).toContain('Your role: the agent for this round. You plan it, then carry it out');
    expect(planning.prompt).toContain('you cannot change files: Shinsa refuses edits until the plan is in.');
    harness.send({ type: 'run.link', runId: planning.id, sessionId: 'round-1', provider: 'claude' });
    proposePlan(harness, taskId);
    const phase = harness.activeRun(taskId);
    expect(phase).toMatchObject({ purpose: 'build', phaseIndex: 0, resume: true, sessionId: 'round-1' });
    expect(phase.prompt).toContain('The plan is in, so building starts.\nNow build phase 1 of 2');
    expect(phase.prompt).not.toContain('The human asked for:');
    const brief = resolveRunBrief(harness.state, phase);
    expect(brief).toContain('Your conversation may no longer hold this round');
    expect(brief).toContain('The human asked for:\nShip the API');
    expect(brief).toContain('Now build phase 1 of 2');
    expect(resolveRunBrief(harness.state, planning)).toBe(planning.prompt ?? '');
    expect(resolveRunBrief(harness.state, { ...phase, taskId: 'gone' })).toBe(phase.prompt ?? '');
  });

  test('without a session to resume, the first phase gets the round brief in its own prompt', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Ship the API' });
    readyWorktree(harness, taskId);
    proposePlan(harness, taskId);
    const phase = harness.activeRun(taskId);
    expect(phase.resume).toBe(false);
    expect(phase.prompt).toContain('The human asked for:\nShip the API');
    expect(phase.rolePrompt).not.toContain('The human asked for:');
  });

  test('the first phase after an approved plan or an operation says so, with the human’s answers', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const task = harness.task(taskId);
    const plan = task.plan ? { ...task.plan, approvedAt: 1 } : null;
    expect(resolvePhaseInstruction({ ...task, plan, planAnswers: 'Use the cache.' }, null, 0)).toContain(
      'The human approved the plan. They answered: Use the cache.'
    );
    expect(
      resolvePhaseInstruction(
        { ...task, result: { step: 'operate', body: 'Ran it.', runId: 'r', at: 1 } },
        null,
        0
      )
    ).toContain('The operation is done.');
    expect(resolveOperationInstruction({ ...task, plan }, null)).toContain('The human approved the plan.');
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

describe('a later round’s agent', () => {
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
    expect(planner).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(planner.prompt).toContain(
      'An earlier round of this task has an open pull request, so this round ships through it'
    );
    expect(planner.prompt).not.toContain('- `shape` when the request needs no change at all');
  });
});
