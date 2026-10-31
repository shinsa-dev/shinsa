import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Gate, type PipelineStep, VERIFICATION_RULES } from '@shinsa/core';
import { IMPACT, PLAN, toolPlan, World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

const BACKFILL = [
  'Run `bun scripts/backfill.ts --dry-run` and check it lists both greeting files.',
  'Run it without `--dry-run` and check `backfilled.txt` names both files.',
];

const CHANGE: PipelineStep[] = [
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
];

const CHANGE_THEN_OPERATE: PipelineStep[] = [...CHANGE, 'operate'];

function resolveRuleMessage(id: string) {
  return VERIFICATION_RULES.find((rule) => rule.id === id)?.message ?? `no rule ${id}`;
}

async function reachOperationGate(w: World) {
  const refusals: string[] = [];
  w.agents.queue('plan', async (agent) => {
    await agent.call('reshape_task', {
      steps: CHANGE_THEN_OPERATE,
      reason: 'The files need a backfill once they ship.',
    });
  });
  w.agents.queue('plan', async (agent) => {
    await agent.call('propose_plan', toolPlan(PLAN)).catch((error: Error) => refusals.push(error.message));
    await agent.call('propose_plan', { ...toolPlan(PLAN), operation: BACKFILL, impact: IMPACT });
  });
  const taskId = await w.createTask('Add the greeting files and backfill them');
  const plan = await w.untilGate(taskId, 'plan');
  await w.answer(plan, 'approve');
  await w.answer(await w.untilGate(taskId, 'review'), 'approve');
  await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
  w.github.update(1, { checks: 'passing' });
  await w.sync(taskId);
  await w.answer(await w.untilGate(taskId, 'merge'), 'approve');
  const gate = await w.untilGate(taskId, 'operation');
  return { taskId, plan, gate, refusals };
}

function expectOperationGate(w: World, taskId: string, gate: Gate) {
  const commit = w.github.pulls[0]?.mergeCommit ?? '';
  expect(commit).toMatch(/^[0-9a-f]{40}$/);
  expect(w.task(taskId)).toMatchObject({
    stage: 'awaiting_operation',
    pullRequest: { state: 'merged', mergeCommit: commit },
  });
  expect(gate).toMatchObject({
    title: 'The change merged. Run the operation now?',
    commit,
    body: [
      `Pull request #1 merged as \`${commit.slice(0, 7)}\`. The merged code can differ from the plan you approved, so check it before the operation runs.`,
      '',
      '## Operation',
      `1. ${BACKFILL[0]}`,
      `2. ${BACKFILL[1]}`,
      '',
      '## Impact',
      IMPACT,
    ].join('\n'),
  });
  expect(w.agents.of('operate')).toHaveLength(0);
}

describe('a task the planner composes from a change and an operation', () => {
  test('ships the change, waits for your OK on the merged commit, then runs the operation on the merged code', async () => {
    const w = await World.create();
    world = w;
    let operatorBrief = '';
    let operatorFiles: string[] = [];
    w.agents.queue('operate', async (agent) => {
      operatorBrief = agent.prompt;
      operatorFiles = ['a.txt', 'b.txt'].filter((file) => existsSync(join(agent.cwd, file)));
      agent.write('backfilled.txt', 'a.txt\nb.txt\n');
      await agent.call('report_outcome', { outcome: 'Backfilled both greeting files.' });
    });

    const { taskId, plan, gate, refusals } = await reachOperationGate(w);
    expect(refusals).toEqual([
      `${resolveRuleMessage('operation.impact')} ${resolveRuleMessage('operation.steps')}`,
    ]);
    expect(plan.body).toContain(`## Operation\n1. ${BACKFILL[0]}\n2. ${BACKFILL[1]}`);
    expect(plan.body).toContain(`## Impact\n${IMPACT}`);
    expect(w.agents.of('build')[0]?.prompt).toContain(
      "Do not run the plan's operation yet: you run it after the pull request merges and the human confirms it."
    );
    expectOperationGate(w, taskId, gate);

    await expect(w.answer(gate, 'revise', 'Do it differently.')).rejects.toThrow(
      'Run the operation or finish without it.'
    );
    expect(w.gates(taskId).map((open) => open.id)).toEqual([gate.id]);
    expect(w.agents.of('operate')).toHaveLength(0);

    await w.answer(gate, 'approve');
    await w.untilStage(taskId, 'done');
    expect(w.github.pulls[0]).toMatchObject({ state: 'MERGED' });
    expect(w.task(taskId)).toMatchObject({
      stageReason: 'the operation finished',
      pipeline: CHANGE_THEN_OPERATE,
      pullRequest: { state: 'merged' },
      result: { step: 'operate', body: 'Backfilled both greeting files.' },
    });
    expect(operatorBrief).toContain('The code change in the plan has merged into the default branch');
    expect(operatorBrief).toContain(`The operation to run:\n1. ${BACKFILL[0]}\n2. ${BACKFILL[1]}`);
    expect(operatorFiles).toEqual(['a.txt', 'b.txt']);
    expect(w.agents.sessions.map((session) => session.key)).toEqual([
      'plan',
      'plan',
      'build',
      'build',
      'reviewer',
      'operate',
    ]);
    expect(w.gates(taskId)).toEqual([]);
    await w.until('the worktree to be removed', () => w.task(taskId).worktreePath === null);
  });

  test('rejecting the operation after the merge finishes the task without running it', async () => {
    const w = await World.create();
    world = w;
    const { taskId, gate } = await reachOperationGate(w);
    expectOperationGate(w, taskId, gate);

    await w.answer(gate, 'reject');
    await w.untilStage(taskId, 'done');
    expect(w.task(taskId)).toMatchObject({
      stageReason: 'merged without running the operation',
      pullRequest: { state: 'merged' },
    });
    expect(w.agents.of('operate')).toHaveLength(0);
    expect(w.gates(taskId)).toEqual([]);
  });
});

describe('the verification rules a composition and its plan must pass', () => {
  test('a plan with no verification plan comes back to the planner, which proposes again and building starts', async () => {
    const w = await World.create();
    world = w;
    const refusals: string[] = [];
    w.agents.queue('plan', async (agent) => {
      await agent
        .call('propose_plan', { ...toolPlan(PLAN), verification: [] })
        .catch((error: Error) => refusals.push(error.message));
      await agent.call('propose_plan', toolPlan(PLAN));
    });
    const taskId = await w.createTask();
    await w.untilGate(taskId, 'review');
    expect(refusals).toEqual([resolveRuleMessage('code.verification_plan')]);
    expect(w.task(taskId).plan?.document?.verification).toEqual(PLAN.verification);
    expect(w.agents.sessions.map((session) => session.key)).toEqual(['plan', 'build', 'build', 'reviewer']);
  });

  test('a code change composed without checks or an agent review is refused with each rule, then planned as a change', async () => {
    const w = await World.create();
    world = w;
    const refusals: string[] = [];
    let unchanged = '';
    w.agents.queue('plan', async (agent) => {
      await agent
        .call('reshape_task', {
          steps: ['plan', 'build', 'your_review', 'pull_request', 'merge'],
          reason: 'Small enough to skip the checks.',
        })
        .catch((error: Error) => refusals.push(error.message));
      await agent
        .call('reshape_task', {
          steps: ['plan', 'build', 'checks', 'your_review', 'pull_request', 'merge'],
          reason: 'Checks, but no review.',
        })
        .catch((error: Error) => refusals.push(error.message));
      unchanged = await agent.call('reshape_task', {
        steps: CHANGE,
        reason: 'A change, checked and reviewed.',
      });
      await agent.call('propose_plan', toolPlan(PLAN));
    });
    const taskId = await w.createTask();
    await w.untilGate(taskId, 'review');
    expect(refusals).toEqual([
      `${resolveRuleMessage('code.checks')} ${resolveRuleMessage('code.agent_review')}`,
      resolveRuleMessage('code.agent_review'),
    ]);
    expect(unchanged).toBe('Those are the steps this task already has. Plan it with `propose_plan`.');
    expect(w.task(taskId).pipeline).toEqual(CHANGE);
    expect(w.agents.sessions.map((session) => session.key)).toEqual(['plan', 'build', 'build', 'reviewer']);
  });

  test("the plan's test evidence is a linked check, required before the last phase, and its checks run with the repository's", async () => {
    const w = await World.create();
    world = w;
    let refusal = '';
    w.agents.queue('plan', async (agent) => {
      const verification = [{ label: 'Greeting not empty', command: 'test -s a.txt', phases: [1, 2] }];
      await agent.call('propose_plan', toolPlan({ ...PLAN, evidence: ['test'], verification }));
    });
    w.agents.queue('build', async (agent) => {
      agent.write('a.txt', 'phase 1\n');
      await agent.call('complete_phase', {
        summary: 'Wrote a.txt.',
        spots: [{ file: 'a.txt', start: 1, end: 1, attention: 'normal', why: 'The new file.' }],
        judgement_calls: [],
      });
    });
    w.agents.queue('build', async (agent) => {
      agent.write('b.txt', 'phase 2\n');
      const report = { summary: 'Wrote b.txt.', spots: [], judgement_calls: [] };
      refusal = await agent.call('complete_phase', report).catch((error: Error) => error.message);
      await agent.call('attach_evidence', { kind: 'test', check: 'c1', detail: 'The greeting is written.' });
      await agent.call('complete_phase', report);
    });
    const taskId = await w.createTask();
    await w.untilGate(taskId, 'review');
    expect(refusal).toContain('Attach it with `attach_evidence` before you complete the last phase.');
    expect(w.task(taskId).checkResults?.map((check) => [check.id, check.command, check.outcome])).toEqual([
      ['c1', 'test -s a.txt', 'pass'],
      ['r1', 'test -f a.txt', 'pass'],
      ['r2', 'test -f b.txt', 'pass'],
    ]);
    const linked = Object.values(w.state.evidence).find(
      (item) => item.runId !== null && item.checkId === 'c1'
    );
    expect(linked).toMatchObject({ kind: 'test', title: 'Greeting not empty', uri: 'shinsa://check/c1' });
  });
});
