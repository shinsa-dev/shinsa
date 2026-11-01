import { describe, expect, test } from 'bun:test';
import {
  type DomainError,
  listMergeSteps,
  listOpenGates,
  listOpenMergeSteps,
  type MergeStep,
  resolveMergeStepKey,
  resolveQueue,
  resolveTaskPipeline,
  resolveTaskProgress,
  selectLeadGate,
  serializeTaskDetail,
} from '../../src/index.ts';
import {
  approve,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  proposePlan,
  pullRequest,
  pushed,
  REPLY,
  reachShipping,
  readyWorktree,
} from '../harness.ts';

const SECRET: MergeStep = {
  when: 'pre_merge',
  kind: 'secret',
  title: 'Set STRIPE_WEBHOOK_SECRET',
  detail: 'In the API service’s production environment, from the Stripe dashboard.',
  command: null,
};

const MIGRATION: MergeStep = {
  when: 'post_merge',
  kind: 'migration',
  title: 'Run the migration',
  detail: 'Adds the invoices table.',
  command: 'bun run db:migrate',
};

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return { code: (error as DomainError).code, message: (error as Error).message };
  }
  throw new Error('expected a refusal');
}

function handOver(harness: Harness, taskId: string, steps: MergeStep[]) {
  proposePlan(harness, taskId);
  completePhase(harness, taskId);
  harness.send({
    type: 'agent.complete_phase',
    runId: harness.activeRun(taskId).id,
    summary: 'Wired the webhook.',
    spots: [],
    judgementCalls: [],
    walkthrough: {
      approach: 'Verify, then record.',
      flow: 'webhook → verify → store',
      risks: [],
      testing: { automated: [], manual: [] },
      steps,
    },
  });
}

function reachMergeGate(steps: MergeStep[] = [SECRET, MIGRATION]) {
  const harness = createHarness();
  const taskId = createTask(harness);
  handOver(harness, taskId, steps);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings: [],
  });
  approve(harness, taskId);
  pushed(harness, taskId);
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
  return { harness, taskId };
}

function merge(harness: Harness, taskId: string) {
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
}

function listGateTypes(harness: Harness, taskId: string) {
  return listOpenGates(harness.state, taskId).map((gate) => gate.type);
}

function reviseSteps(harness: Harness, taskId: string, steps: MergeStep[]) {
  if (listOpenGates(harness.state, taskId).length === 0) {
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
  }
  harness.send({
    type: 'gate.answer',
    gateId: harness.openGate(taskId).id,
    decision: 'revise',
    response: 'Again.',
  });
  harness.send({
    type: 'agent.complete_fix',
    runId: harness.activeRun(taskId).id,
    summary: 'Changed the steps.',
    reply: REPLY,
    walkthrough: { steps },
  });
}

function tick(harness: Harness, taskId: string, step: MergeStep, done = true, onBehalf = false) {
  return harness.send(
    { type: 'merge_step.tick', taskId, key: resolveMergeStepKey(step), done },
    { onBehalf }
  );
}

describe('the steps around the merge', () => {
  test('the merge waits until every step before it is ticked', () => {
    const { harness, taskId } = reachMergeGate();
    const gate = harness.openGate(taskId);
    expect(gate.type).toBe('merge');
    expect(refusal(() => approve(harness, taskId))).toEqual({
      code: 'merge_steps_open',
      message: 'Tick the 1 pre-merge step first.',
    });
    tick(harness, taskId, SECRET);
    expect(listOpenMergeSteps(harness.task(taskId), 'pre_merge')).toEqual([]);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Ticked the step “Set STRIPE_WEBHOOK_SECRET”');
    approve(harness, taskId);
    expect(harness.task(taskId).stageReason).toBe('merging');
  });

  test('the bundle merges only once every task below has ticked its steps before the merge', () => {
    const { harness, taskId: root } = reachMergeGate([SECRET]);
    const top = createTask(harness, { request: 'Top', stacksOn: root });
    expect(harness.task(root).bundleReady).toBeTruthy();
    readyWorktree(harness, top);
    reachShipping(harness, top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest({ number: 43 }) });
    expect(harness.openGate(top).type).toBe('merge');
    expect(refusal(() => approve(harness, top))).toEqual({
      code: 'merge_steps_open',
      message: `Tick the 1 pre-merge step of “${harness.task(root).title}” first: it merges with this bundle.`,
    });
    tick(harness, root, SECRET);
    approve(harness, top);
    expect(harness.task(top).stage).toBe('awaiting_merge');
  });

  test('a step ticks and unticks, and ticking it again changes nothing', () => {
    const { harness, taskId } = reachMergeGate();
    tick(harness, taskId, SECRET);
    expect(tick(harness, taskId, SECRET).events).toEqual([]);
    tick(harness, taskId, SECRET, false);
    expect(harness.task(taskId).mergeStepsDone).toEqual([]);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Unticked the step “Set STRIPE_WEBHOOK_SECRET”');
    expect(refusal(() => approve(harness, taskId)).code).toBe('merge_steps_open');
  });

  test('the work report puts your steps into the pipeline, and a fix that clears them takes them out', () => {
    const { harness, taskId } = reachMergeGate();
    expect(resolveTaskPipeline(harness.task(taskId)).slice(-4)).toEqual([
      'pull_request',
      'pre_merge',
      'merge',
      'post_merge',
    ]);
    const added = harness.task(taskId).activity.find((entry) => entry.kind === 'shape');
    expect(added?.text).toBe('Added the steps Pre-merge and Post-merge');
    expect(harness.task(taskId).shapeChanges?.at(-1)?.by).toBe('shinsa');
    reviseSteps(harness, taskId, [MIGRATION]);
    expect(resolveTaskPipeline(harness.task(taskId)).slice(-3)).toEqual([
      'pull_request',
      'merge',
      'post_merge',
    ]);
    expect(
      harness
        .task(taskId)
        .activity.filter((entry) => entry.kind === 'shape')
        .at(-1)?.text
    ).toBe('Removed the step Pre-merge');
    reviseSteps(harness, taskId, [SECRET]);
    expect(
      harness
        .task(taskId)
        .activity.filter((entry) => entry.kind === 'shape')
        .at(-1)?.text
    ).toBe('Added the step Pre-merge and removed the step Post-merge');
  });

  test('Needs you says how many steps are left before the merge, and progress stops at them', () => {
    const { harness, taskId } = reachMergeGate();
    const [entry] = resolveQueue(harness.state, harness.now).ready;
    expect(entry?.reason).toBe('1 pre-merge step for you');
    const progress = resolveTaskProgress(harness.task(taskId));
    expect(progress.current).toMatchObject({ key: 'pre-merge', status: 'waiting', detail: '0 of 1 done' });
    tick(harness, taskId, SECRET);
    expect(resolveQueue(harness.state, harness.now).ready[0]?.reason).not.toContain('before the merge');
    expect(resolveTaskProgress(harness.task(taskId)).current).toMatchObject({
      key: 'merge',
      status: 'waiting',
    });
  });

  test('a step after the merge ticks once the pull request merged, and holds the task open behind its gate', () => {
    const { harness, taskId } = reachMergeGate();
    expect(refusal(() => tick(harness, taskId, MIGRATION))).toEqual({
      code: 'merge_step_early',
      message: 'Tick this once pull request #42 merges.',
    });
    tick(harness, taskId, SECRET);
    approve(harness, taskId);
    merge(harness, taskId);
    expect(harness.task(taskId).stage).toBe('merged');
    expect(listGateTypes(harness, taskId)).toEqual(['post_merge']);
    const gate = harness.openGate(taskId);
    expect(gate.title).toBe('1 post-merge step left');
    expect(gate.body).toContain('- [ ] **Run the migration**: Adds the invoices table.');
    expect(selectLeadGate(harness.state, harness.task(taskId))?.type).toBe('post_merge');
    expect(resolveQueue(harness.state, harness.now).ready.map((entry) => entry.reason)).toEqual([
      'Merged, with steps left for you to do',
    ]);
    expect(resolveTaskProgress(harness.task(taskId)).current).toMatchObject({
      key: 'post-merge',
      status: 'waiting',
      detail: '0 of 1 done',
    });
    expect(
      refusal(() =>
        harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null })
      )
    ).toEqual({
      code: 'decision_invalid',
      message: 'Tick each post-merge step once done.',
    });
    const left = {
      code: 'task_open',
      message: '1 post-merge step is left.',
    };
    expect(refusal(() => harness.send({ type: 'task.complete', taskId }, { onBehalf: true }))).toEqual(left);
    expect(refusal(() => harness.send({ type: 'task.complete', taskId }))).toEqual(left);
    expect(refusal(() => tick(harness, taskId, SECRET, false))).toEqual({
      code: 'merge_step_early',
      message: 'This step was due before the merge.',
    });
    tick(harness, taskId, MIGRATION);
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
    expect(harness.state.gates[gate.id]?.status).toBe('withdrawn');
    expect(resolveTaskProgress(harness.task(taskId)).current).toBeNull();
    tick(harness, taskId, MIGRATION, false);
    expect(listGateTypes(harness, taskId)).toEqual(['post_merge']);
    tick(harness, taskId, MIGRATION);
    harness.send({ type: 'task.complete', taskId }, { onBehalf: true });
    expect(harness.task(taskId).stage).toBe('done');
    expect(refusal(() => tick(harness, taskId, MIGRATION, false))).toEqual({
      code: 'task_settled',
      message: 'This task is finished.',
    });
  });

  test('a merge gate that opens while steps after an earlier merge wait leads over them', () => {
    const { harness, taskId } = reachMergeGate([MIGRATION]);
    approve(harness, taskId);
    merge(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Add a CSV export', kind: 'new_round', title: 'CSV' });
    expect(harness.task(taskId).stage).not.toBe('merged');
    expect(listGateTypes(harness, taskId)).toEqual(['post_merge']);
    const carried = listMergeSteps(harness.task(taskId));
    expect(carried.map((step) => [step.title, step.round, step.due, step.done])).toEqual([
      ['Run the migration', 1, true, false],
    ]);
    expect(resolveTaskPipeline(harness.task(taskId))).not.toContain('post_merge');
    expect(resolveQueue(harness.state, harness.now).working.map((task) => task.id)).toEqual([taskId]);
  });

  test('only the human ticks, a step it does not have, or one of a cancelled task', () => {
    const { harness, taskId } = reachMergeGate();
    expect(refusal(() => tick(harness, taskId, SECRET, true, true)).code).toBe('human_only');
    expect(
      refusal(() => harness.send({ type: 'merge_step.tick', taskId, key: 'pre_merge:Nothing', done: true }))
    ).toEqual({
      code: 'merge_step_not_found',
      message: 'This step is no longer there.',
    });
    harness.send({ type: 'task.cancel', taskId });
    expect(refusal(() => tick(harness, taskId, SECRET)).code).toBe('task_settled');
    expect(resolveTaskPipeline(harness.task(taskId))).toContain('pre_merge');
  });

  test('a step after the merge of a task with no pull request yet names none', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    handOver(harness, taskId, [MIGRATION]);
    expect(refusal(() => tick(harness, taskId, MIGRATION)).message).toBe(
      'Tick this once the pull request merges.'
    );
  });

  test('a fix that sends steps replaces them, and a tick stays only while the step is the same', () => {
    const { harness, taskId } = reachMergeGate();
    tick(harness, taskId, SECRET);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Use a flag.',
    });
    const FLAG: MergeStep = {
      when: 'pre_merge',
      kind: 'config',
      title: 'Turn on invoices',
      detail: 'In LaunchDarkly.',
      command: null,
    };
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Added the flag.',
      reply: REPLY,
      walkthrough: { steps: [SECRET, FLAG] },
    });
    expect(listMergeSteps(harness.task(taskId)).map((step) => [step.title, step.done])).toEqual([
      ['Set STRIPE_WEBHOOK_SECRET', true],
      ['Turn on invoices', false],
    ]);
    const reworded = { ...SECRET, command: 'stripe listen --print-secret' };
    expect(resolveMergeStepKey(reworded)).not.toBe(resolveMergeStepKey(SECRET));
    expect(resolveMergeStepKey({ ...SECRET, detail: 'Elsewhere.' })).not.toBe(resolveMergeStepKey(SECRET));
    reviseSteps(harness, taskId, [reworded, FLAG]);
    expect(listMergeSteps(harness.task(taskId)).map((step) => step.done)).toEqual([false, false]);
  });

  test('the reviewer is told the steps and to check the list is complete', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    handOver(harness, taskId, [SECRET]);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt).toContain(
      'The steps the agent listed for the human around the merge:\n- before the merge, secret: Set STRIPE_WEBHOOK_SECRET'
    );
    expect(prompt).toContain('Check the list is complete:');
    const bare = createHarness();
    const other = createTask(bare);
    handOver(bare, other, []);
    bare.send({ type: 'checks.record', taskId: other, results: PASSING });
    expect(bare.activeRun(other).prompt).toContain(
      'The agent listed no steps for the human around the merge.'
    );
  });

  test('an agent reading the task sees the steps numbered, with their ticks and commands', () => {
    const { harness, taskId } = reachMergeGate();
    tick(harness, taskId, SECRET);
    const detail = serializeTaskDetail(harness.state, taskId);
    expect(detail).toContain(
      [
        'Steps for the human around the merge (only the human ticks them):',
        '  1. [x] before the merge, secret: Set STRIPE_WEBHOOK_SECRET',
        '  2. [ ] after the merge, migration: Run the migration: `bun run db:migrate`',
      ].join('\n')
    );
  });

  test('a new round starts with no step ticked, and drops the steps already done', () => {
    const { harness, taskId } = reachMergeGate();
    tick(harness, taskId, SECRET);
    approve(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    tick(harness, taskId, MIGRATION);
    harness.send({ type: 'task.message', taskId, text: 'Add a CSV export', kind: 'new_round', title: 'CSV' });
    expect(harness.task(taskId).mergeStepsDone).toEqual([]);
    expect(listMergeSteps(harness.task(taskId))).toEqual([]);
    expect(harness.task(taskId).carriedMergeSteps).toEqual([]);
  });

  test('steps after a merge carry over into later rounds until ticked, and close their gate then', () => {
    const { harness, taskId } = reachMergeGate([MIGRATION]);
    approve(harness, taskId);
    merge(harness, taskId);
    const gate = harness.openGate(taskId);
    harness.send({ type: 'task.message', taskId, text: 'Add a CSV export', kind: 'new_round', title: 'CSV' });
    harness.send({ type: 'task.message', taskId, text: 'And a PDF one', kind: 'new_round', title: 'PDF' });
    expect(harness.task(taskId).carriedMergeSteps).toEqual([{ ...MIGRATION, round: 1, done: false }]);
    expect(harness.openGate(taskId).id).toBe(gate.id);
    tick(harness, taskId, MIGRATION);
    expect(harness.task(taskId).carriedMergeSteps).toEqual([{ ...MIGRATION, round: 1, done: true }]);
    expect(harness.state.gates[gate.id]?.status).toBe('withdrawn');
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Ticked the step “Run the migration”');
  });

  test('steps before the merge of a round that shipped onto the open pull request carry into the next', () => {
    const { harness, taskId } = reachMergeGate([SECRET]);
    harness.send({ type: 'task.message', taskId, text: 'Add a CSV export', kind: 'new_round', title: 'CSV' });
    const carried = listMergeSteps(harness.task(taskId));
    expect(carried.map((step) => [step.title, step.round, step.due])).toEqual([
      ['Set STRIPE_WEBHOOK_SECRET', 1, true],
    ]);
    expect(resolveTaskPipeline(harness.task(taskId))).toContain('pre_merge');
    tick(harness, taskId, SECRET);
    expect(listOpenMergeSteps(harness.task(taskId), 'pre_merge')).toEqual([]);
  });
});
