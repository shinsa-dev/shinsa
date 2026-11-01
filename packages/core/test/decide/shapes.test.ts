import { describe, expect, test } from 'bun:test';
import { acceptsFollowUp, resolveNextStep } from '../../src/decide/shapes.ts';
import {
  listActiveRuns,
  listOpenGates,
  type PipelineStep,
  resolveFallbackBriefing,
  resolveMessageEffect,
  resolveQueue,
  resolveQueueSummary,
  resolveTaskProgress,
  resolveTaskRounds,
  resolveTaskShape,
  SHAPE_PIPELINES,
  type TaskShape,
} from '../../src/index.ts';
import {
  approve,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  IMPACT,
  linkSession,
  PASSING,
  PLAN,
  proposePlan,
  pullRequest,
  pushed,
  REPLY,
  registerRepo,
  resolveReply,
  shipAndMerge,
  verifySetup,
} from '../harness.ts';

interface StartOptions {
  shape?: TaskShape;
  mode?: 'ask';
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  waitsOn?: string[];
  triage?: { shape?: TaskShape; priority?: 'urgent' | 'high' | 'normal' | 'low'; waitsOn?: string[] };
  request?: string;
}

function start(harness: Harness, options: StartOptions = {}) {
  const repoId = Object.keys(harness.state.repos)[0] || registerRepo(harness);
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({
    type: 'task.create',
    request: options.request ?? 'Why does the export hang on large files?',
    repoId: null,
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.priority ? { priority: options.priority } : {}),
    ...(options.waitsOn ? { waitsOn: options.waitsOn } : {}),
  });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Find why the export hangs',
    repoId,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn: options.triage?.waitsOn ?? [],
    ...(options.shape || options.triage?.shape ? { shape: options.shape ?? options.triage?.shape } : {}),
    ...(options.triage?.priority ? { priority: options.triage.priority } : {}),
    reasons: { shape: 'It asks why something happens.', priority: 'Nothing urgent.', start: 'Independent.' },
  });
  return taskId;
}

function ready(harness: Harness, taskId: string) {
  harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: `fix/${taskId}` });
}

function passSetup(harness: Harness, taskId: string) {
  verifySetup(harness, taskId);
  if (harness.task(taskId).stage === 'triage') ready(harness, taskId);
}

function deliver(
  harness: Harness,
  taskId: string,
  step: 'investigate' | 'research' | 'operate',
  proposal: { request: string; why: string } | null = null
) {
  const runId = harness.activeRun(taskId).id;
  harness.send({
    type: 'agent.deliver',
    runId,
    step,
    body: `The ${step} result.`,
    ...resolveReply(harness, runId),
    ...(proposal ? { proposal } : {}),
  });
}

const PROPOSAL = { request: 'Stream the export in chunks.', why: 'It reads the whole file into memory.' };

describe('choosing the shape', () => {
  test('triage decides the shape, the priority and the start when they were left to Shinsa, and says why', () => {
    const harness = createHarness();
    const other = createTask(harness, { request: 'Rework the exporter' });
    const taskId = start(harness, { triage: { shape: 'answer', priority: 'high', waitsOn: [other] } });
    const task = harness.task(taskId);
    expect(task.auto).toEqual({ shape: true, start: true, priority: true });
    expect(resolveTaskShape(task)).toBe('answer');
    expect(task.priority).toBe('high');
    expect(task.waitsOn).toEqual([other]);
    expect(task.triageDecisions).toEqual({
      shape: { value: 'answer', why: 'It asks why something happens.' },
      start: { value: [other], why: 'Independent.' },
      priority: { value: 'high', why: 'Nothing urgent.' },
    });
    expect(task.branch).toBeNull();
    expect(task.proposedBranch).toBe(`fix/${taskId}`);
  });

  test('the priority and the start you picked stay, and triage records no decision for them', () => {
    const harness = createHarness();
    const other = createTask(harness, { request: 'Rework the exporter' });
    const taskId = start(harness, {
      priority: 'low',
      waitsOn: [],
      triage: { shape: 'research', priority: 'urgent', waitsOn: [other] },
    });
    const task = harness.task(taskId);
    expect(resolveTaskShape(task)).toBe('research');
    expect(task.priority).toBe('low');
    expect(task.waitsOn).toEqual([]);
    expect(task.auto).toEqual({ shape: true, start: false, priority: false });
    expect(task.triageDecisions).toEqual({
      shape: { value: 'research', why: 'It asks why something happens.' },
      start: null,
      priority: null,
    });
    expect(task.activity.find((entry) => entry.kind === 'set_up')?.text).toBe(
      'Set up as research for a report in paywall-next'
    );
  });

  test('a new task takes no shape: only triage shapes it, unless you asked a question', () => {
    const harness = createHarness();
    const asked = start(harness, { mode: 'ask', triage: { shape: 'research' } });
    expect(harness.task(asked).auto?.shape).toBe(false);
    expect(resolveTaskShape(harness.task(asked))).toBe('answer');
    expect(harness.task(asked).triageDecisions?.shape).toBeNull();
  });

  test('a triage without a shape keeps the default change, and a missing why stays empty', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'Add a flag', repoId: registerRepo(harness) });
    const taskId = Object.keys(harness.state.tasks)[0] ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'Add a flag',
      repoId: harness.task(taskId).repoId ?? '',
      size: 'small',
      branch: 'feat/flag',
      waitsOn: [],
    });
    expect(resolveTaskShape(harness.task(taskId))).toBe('change');
    expect(harness.task(taskId).triageDecisions?.shape).toEqual({ value: 'change', why: '' });
    expect(harness.task(taskId).branch).toBe('feat/flag');
  });
});

describe('an investigation', () => {
  test('runs in a worktree, reports its diagnosis and finishes without a plan or a pull request', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    const run = harness.activeRun(taskId);
    expect(run.role).toBe('investigator');
    expect(harness.task(taskId).stage).toBe('investigating');
    expect(run.prompt).toContain('this worktree is scratch');
    expect(run.prompt).toContain('`propose_change`');
    deliver(harness, taskId, 'investigate');
    const task = harness.task(taskId);
    expect(task).toMatchObject({
      stage: 'answered',
      stageReason: 'reported its diagnosis',
      plan: null,
      pullRequest: null,
    });
    expect(task.result).toMatchObject({ step: 'investigate', body: 'The investigate result.' });
    expect(task.activity.map((entry) => entry.text)).toContain('Reported the diagnosis');
    expect(harness.openGate(taskId)).toMatchObject({ type: 'result', title: 'Read the diagnosis' });
    expect(acceptsFollowUp(task)).toBe(true);
    expect(resolveTaskProgress(task).phases.map((phase) => `${phase.key}:${phase.status}`)).toEqual([
      'setup:done',
      'investigate:done',
    ]);
  });

  test('a proposed fix waits for your OK, and approving turns the task into a change', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate', PROPOSAL);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'proposal', title: 'Turn this investigation into a fix?' });
    expect(harness.task(taskId).pipeline).toEqual(['investigate', 'your_ok', ...SHAPE_PIPELINES.change]);
    expect(harness.task(taskId)).toMatchObject({ stage: 'awaiting_proposal', proposal: { status: 'open' } });
    expect(resolveTaskProgress(harness.task(taskId)).current).toMatchObject({
      key: 'proposal',
      status: 'waiting',
    });
    approve(harness, taskId);
    const task = harness.task(taskId);
    expect(resolveTaskShape(task)).toBe('fix');
    expect(task.proposal?.status).toBe('accepted');
    expect(task.shapeChanges?.at(-1)).toMatchObject({ by: 'agent', from: ['investigate'] });
    expect(task.activity.map((entry) => entry.text)).toContain('Turned into an investigation, then a change');
    expect(task.stage).toBe('triage');
    expect(task.stageReason).toBe('verifying the setup');
    expect(harness.lastEffect('config.verify').taskId).toBe(taskId);
    passSetup(harness, taskId);
    const planner = harness.activeRun(taskId);
    expect(planner).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(planner.prompt).toContain('The diagnosis from the investigation:\nThe investigate result.');
    expect(planner.prompt).toContain('The human approved going on after that:\nStream the export in chunks.');
  });

  test('the Agent resumes the investigator’s session after your OK: one root agent for the round', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    const investigator = harness.activeRun(taskId);
    linkSession(harness, taskId, 'session-investigate');
    deliver(harness, taskId, 'investigate', PROPOSAL);
    approve(harness, taskId);
    passSetup(harness, taskId);
    const agent = harness.activeRun(taskId);
    expect(agent).toMatchObject({
      role: 'agent',
      purpose: 'plan',
      resume: true,
      sessionId: 'session-investigate',
      provider: investigator.provider,
      model: investigator.model,
    });
    expect(agent.prompt).toContain('The diagnosis from the investigation:\nThe investigate result.');
    linkSession(harness, taskId, 'session-investigate');
    proposePlan(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ purpose: 'build', sessionId: 'session-investigate' });
  });

  test('when the inquiry ran on the same provider but another model, the Agent resumes its session on its own model', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { agentModels: { answerer: 'sonnet' } } });
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'investigator', model: 'sonnet' });
    linkSession(harness, taskId, 'session-investigate');
    deliver(harness, taskId, 'investigate', PROPOSAL);
    approve(harness, taskId);
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'agent',
      purpose: 'plan',
      resume: true,
      sessionId: 'session-investigate',
      model: 'opus',
    });
  });

  test('when the inquiry ran on another provider, the Agent starts fresh with the full brief and the result', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { agentProviders: { answerer: 'codex' } } });
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'investigator', provider: 'codex' });
    linkSession(harness, taskId, 'session-investigate');
    deliver(harness, taskId, 'investigate', PROPOSAL);
    approve(harness, taskId);
    passSetup(harness, taskId);
    const agent = harness.activeRun(taskId);
    expect(agent).toMatchObject({
      role: 'agent',
      purpose: 'plan',
      resume: false,
      sessionId: null,
      model: 'opus',
    });
    expect(agent.prompt).toContain(
      'Your role: the agent for this task, in one conversation across all of its rounds.'
    );
    expect(agent.prompt).toContain('The diagnosis from the investigation:\nThe investigate result.');
    expect(agent.prompt).toContain('The human approved going on after that:\nStream the export in chunks.');
  });

  test('declining the fix finishes the task as an investigation', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate', PROPOSAL);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'done',
      stageReason: 'kept as an investigation',
      proposal: { status: 'declined' },
      pipeline: ['investigate'],
    });
    expect(harness.task(taskId).shapeChanges?.at(-1)).toMatchObject({ by: 'you', to: ['investigate'] });
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'missing', decision: 'approve', response: null })
    ).toThrow('No gate missing');
  });

  test('a message while the fix waits goes back to the investigator and withdraws the proposal', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    harness.send({
      type: 'run.link',
      runId: harness.activeRun(taskId).id,
      sessionId: 'inv-1',
      provider: 'claude',
    });
    deliver(harness, taskId, 'investigate', PROPOSAL);
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('decline_proposal');
    harness.send({ type: 'task.message', taskId, text: 'Check the CSV path too.' });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId)).toMatchObject({ stage: 'investigating', proposal: { status: 'declined' } });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'investigator', sessionId: 'inv-1' });
    expect(harness.activeRun(taskId).prompt).toContain('The human followed up:\nCheck the CSV path too.');
  });

  test('a message at your OK declines the proposal even when it reads as new work', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate', PROPOSAL);
    harness.send({
      type: 'task.message',
      taskId,
      text: 'Also check exports.',
      kind: 'new_round',
      shape: 'change',
    });
    expect(resolveTaskRounds(harness.task(taskId))).toHaveLength(1);
    expect(harness.task(taskId)).toMatchObject({ stage: 'investigating', proposal: { status: 'declined' } });
  });

  test('a proposed change reads as one in Needs you, the guide and the status summary', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate', PROPOSAL);
    const queue = resolveQueue(harness.state, harness.now);
    expect(queue.ready[0]?.reason).toBe('An agent proposes what comes next and waits for your OK');
    expect(resolveFallbackBriefing(queue, harness.now).now?.why).toBe(
      'An agent proposes what comes next, and it goes on only if you agree'
    );
    expect(resolveQueueSummary(harness.state, harness.now, 'http://x').decisions[0]?.label).toBe('Proposal');
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain('Investigation started');
  });

  test('the proposal gate takes only approve or reject, and retry leaves it for you', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'investigate' });
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate', PROPOSAL);
    harness.send({ type: 'task.retry', taskId });
    expect(harness.task(taskId).stage).toBe('awaiting_proposal');
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: harness.openGate(taskId).id,
        decision: 'revise',
        response: 'x',
      })
    ).toThrow('Approve the proposal or keep the task.');
  });
});

describe('find and fix', () => {
  test('investigates first, then resets the worktree and plans the fix without asking again', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'fix' });
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId).role).toBe('investigator');
    expect(harness.activeRun(taskId).prompt).toContain('The human already asked for a fix');
    deliver(harness, taskId, 'investigate', PROPOSAL);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId)).toMatchObject({ stage: 'triage', stageReason: 'setting up the worktree' });
    expect(harness.effectsOf('worktree.create')).toHaveLength(2);
    expect(resolveNextStep(harness.task(taskId))).toBe('plan');
    expect(
      resolveTaskProgress(harness.task(taskId))
        .phases.slice(0, 3)
        .map((phase) => phase.status)
    ).toEqual(['done', 'done', 'pending']);
    ready(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'plan' });
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    expect(harness.openGate(taskId).type).toBe('review');
  });
});

describe('research', () => {
  test('a read-only researcher writes the report, and a follow-up resumes it', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'research', request: 'Compare the two queue libraries' });
    verifySetup(harness, taskId);
    expect(harness.effectsOf('worktree.create')).toHaveLength(0);
    const run = harness.activeRun(taskId);
    expect(run.role).toBe('researcher');
    expect(run.prompt).toContain('This task produces a report, not a change');
    expect(run.prompt).toContain('The repository is checked out at `/code/paywall-next`');
    harness.send({ type: 'run.link', runId: run.id, sessionId: 'res-1', provider: 'claude' });
    deliver(harness, taskId, 'research');
    expect(harness.task(taskId)).toMatchObject({ stage: 'answered', stageReason: 'wrote the report' });
    expect(harness.openGate(taskId).title).toBe('Read the report');
    harness.send({ type: 'task.message', taskId, text: 'Add the licences.' });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'researcher', sessionId: 'res-1' });
    expect(harness.task(taskId).stage).toBe('researching');
  });

  test('a report can propose a change, and approving it sets up a worktree on the proposed branch', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'research' });
    verifySetup(harness, taskId);
    deliver(harness, taskId, 'research', PROPOSAL);
    expect(harness.openGate(taskId).title).toBe('Turn this report into a change?');
    approve(harness, taskId);
    expect(harness.task(taskId).branch).toBe(`fix/${taskId}`);
    verifySetup(harness, taskId);
    expect(harness.lastEffect('worktree.create').taskId).toBe(taskId);
  });

  test('a researcher or an investigator cannot hand over the other one’s result', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'research' });
    verifySetup(harness, taskId);
    expect(() => deliver(harness, taskId, 'investigate')).toThrow(
      'You are researching: hand the report over with `submit_report`.'
    );
  });
});

describe('an answer', () => {
  test('can propose a change, and messages after it is declined ask a follow-up', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'answer' });
    verifySetup(harness, taskId);
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'answer',
      body: 'It does.',
      proposal: PROPOSAL,
    });
    expect(harness.openGate(taskId).title).toBe('Turn this answer into a change?');
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(harness.task(taskId).stageReason).toBe('kept as an answer');
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('follow_up');
    harness.send({ type: 'task.message', taskId, text: 'Why though?' });
    expect(harness.task(taskId).stage).toBe('answering');
  });

  test('approving the change keeps the answer and plans with it', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'answer' });
    verifySetup(harness, taskId);
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'answer',
      body: 'It does.',
      proposal: PROPOSAL,
    });
    approve(harness, taskId);
    expect(resolveTaskShape(harness.task(taskId))).toBe('change');
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId).prompt).toContain('The answer given earlier on this task:\nIt does.');
  });
});

describe('an operation', () => {
  test('always waits for its plan, then runs and reports without a pull request', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'operation', request: 'Regenerate the lockfile' });
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId).prompt).toContain('This task is an operation');
    proposePlan(harness, taskId);
    expect(harness.openGate(taskId).type).toBe('plan');
    approve(harness, taskId);
    const run = harness.activeRun(taskId);
    expect(run).toMatchObject({ role: 'agent', purpose: 'operate' });
    expect(harness.task(taskId).stage).toBe('operating');
    expect(run.prompt).toContain('Now run the operation in the plan, step by step');
    expect(run.prompt).toContain('This is plan version 1, approved by the human.');
    harness.send({ type: 'task.message', taskId, text: 'Use bun 1.3.' });
    harness.send({ type: 'message.deliver', taskId, text: 'Use bun 1.3 everywhere.' });
    expect(harness.activeRun(taskId).prompt).toContain('Guidance from the human:\nUse bun 1.3 everywhere.');
    deliver(harness, taskId, 'operate');
    expect(harness.task(taskId).iterations?.map((iteration) => iteration.reply)).toEqual([REPLY]);
    expect(harness.task(taskId)).toMatchObject({ stage: 'done', stageReason: 'the operation finished' });
    expect(acceptsFollowUp(harness.task(taskId))).toBe(false);
    harness.send({
      type: 'task.message',
      taskId,
      text: 'Run it on staging too.',
      kind: 'new_round',
      shape: 'operation',
    });
    expect(harness.task(taskId)).toMatchObject({ stage: 'triage', pipeline: ['plan', 'operate'] });
    expect(harness.task(taskId).rounds?.map((round) => [round.number, round.status])).toEqual([
      [1, 'finished'],
      [2, 'active'],
    ]);
  });

  test('a paused operation retries the agent, and a message restarts it with the guidance', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'operation' });
    passSetup(harness, taskId);
    proposePlan(harness, taskId);
    approve(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Broke', detail: 'x' });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'operate' });
    harness.send({ type: 'effect.fail', taskId, title: 'Broke again', detail: 'x' });
    harness.send({ type: 'message.deliver', taskId, text: 'Skip the cache.' });
    expect(harness.activeRun(taskId).prompt).toContain('Guidance from the human:\nSkip the cache.');
  });

  test('an operation without a code change attaches the evidence its plan asks for before it reports', () => {
    const harness = createHarness();
    const taskId = start(harness, { shape: 'operation' });
    passSetup(harness, taskId);
    proposePlan(harness, taskId, { ...PLAN, verification: [], evidence: ['note'] });
    approve(harness, taskId);
    const runId = harness.activeRun(taskId).id;
    expect(() => deliver(harness, taskId, 'operate')).toThrow(
      'The plan asks for a note (`note`) as evidence. Attach it with `attach_evidence` before you report the outcome.'
    );
    expect(harness.task(taskId).stage).toBe('operating');
    harness.send({
      type: 'agent.attach_evidence',
      runId,
      kind: 'note',
      title: 'Rows changed',
      uri: 'note.md',
    });
    deliver(harness, taskId, 'operate');
    expect(harness.task(taskId)).toMatchObject({ stage: 'done', result: { step: 'operate' } });
  });
});

describe('the agent reshapes', () => {
  test('a task Shinsa shaped into an answer when there is nothing to change', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'How does the retry work?' });
    const planner = harness.activeRun(taskId);
    expect(planner.prompt).toContain('`reshape_task`');
    harness.send({ type: 'agent.reshape', runId: planner.id, shape: 'answer', reason: 'It is a question.' });
    const task = harness.task(taskId);
    expect(resolveTaskShape(task)).toBe('answer');
    expect(task.activity.at(-2)).toMatchObject({ kind: 'shape', text: 'Turned into a question to answer' });
    expect(harness.activeRun(taskId).role).toBe('answerer');
    expect(listActiveRuns(harness.state, taskId).find((run) => run.id === planner.id)).toBeUndefined();
  });

  test('never a task whose kind was set when it was created, such as a split of a plan', () => {
    const harness = createHarness();
    const parent = createTask(harness);
    proposePlan(harness, parent);
    harness.send({
      type: 'agent.split_task',
      runId: harness.activeRun(parent).id,
      requests: ['Split one'],
      thisWaits: false,
    });
    const taskId =
      Object.values(harness.state.tasks).find((task) => task.createdBy?.kind === 'split')?.id ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'Split one',
      repoId: harness.task(parent).repoId ?? '',
      size: 'small',
      branch: `fix/${taskId}`,
      waitsOn: [],
      shape: 'answer',
    });
    expect(resolveTaskShape(harness.task(taskId))).toBe('change');
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId).prompt).not.toContain('`reshape_task`');
    const run = { type: 'agent.reshape' as const, shape: 'answer' as const, reason: 'Nothing to do.' };
    expect(() => harness.send({ ...run, runId: harness.activeRun(taskId).id })).toThrow(
      'The kind of this task was set when it was created.'
    );
  });

  test('once a plan exists the agent revises it instead', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Smaller.',
    });
    expect(() =>
      harness.send({
        type: 'agent.reshape',
        runId: harness.activeRun(taskId).id,
        shape: 'answer',
        reason: 'x',
      })
    ).toThrow('This task already has a plan.');
  });
});

describe('the inquiry steps', () => {
  test('retry and a late message start the researcher or the investigator again', () => {
    const harness = createHarness();
    const research = start(harness, { shape: 'research' });
    verifySetup(harness, research);
    harness.send({ type: 'effect.fail', taskId: research, title: 'Broke', detail: 'x' });
    harness.send({ type: 'task.retry', taskId: research });
    expect(harness.activeRun(research).role).toBe('researcher');
    harness.send({ type: 'message.deliver', taskId: research, text: 'Add a table.' });
    expect(harness.activeRun(research).prompt).toContain('The human followed up:\nAdd a table.');
    const investigation = start(harness, { shape: 'investigate' });
    passSetup(harness, investigation);
    harness.send({ type: 'effect.fail', taskId: investigation, title: 'Broke', detail: 'x' });
    harness.send({ type: 'task.retry', taskId: investigation });
    expect(harness.activeRun(investigation).role).toBe('investigator');
    harness.send({ type: 'message.deliver', taskId: investigation, text: 'Try Safari.' });
    expect(harness.activeRun(investigation).prompt).toContain('The human followed up:\nTry Safari.');
  });

  test('the agent that reshapes to research hands the existing worktree to a read-only researcher', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Compare the queue libraries' });
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(taskId).id,
      shape: 'research',
      reason: 'A comparison.',
    });
    expect(harness.activeRun(taskId).prompt).toContain(
      `You work in the task's worktree at \`/wt/${taskId}\``
    );
  });

  test('the agent that reshapes back to an investigation already delivered finishes the task', () => {
    const harness = createHarness();
    const taskId = start(harness, { triage: { shape: 'fix' } });
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate');
    ready(harness, taskId);
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(taskId).id,
      shape: 'investigate',
      reason: 'The findings are enough.',
    });
    expect(harness.task(taskId)).toMatchObject({ stage: 'done', stageReason: 'finished every step' });
  });
});

describe('a task without a chosen shape', () => {
  test('reads as a change before triage picks its steps, and an Ask task as an answer', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'task.create', request: 'How?', repoId, mode: 'ask' });
    const ask = Object.keys(harness.state.tasks)[0] ?? '';
    expect(harness.task(ask).auto).toEqual({ shape: false, start: true, priority: true });
    expect(resolveTaskShape(harness.task(ask))).toBe('answer');
    const unshaped = { ...harness.task(ask), mode: undefined, pipeline: undefined };
    expect(resolveTaskShape(unshaped)).toBe('change');
  });

  test('a split plan files its sub-tasks as changes', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({
      type: 'agent.split_task',
      runId: harness.activeRun(taskId).id,
      requests: ['Split one', 'Split two'],
      thisWaits: false,
    });
    const created = Object.values(harness.state.tasks).filter((task) => task.createdBy?.kind === 'split');
    expect(created.map((task) => [resolveTaskShape(task), task.auto?.shape])).toEqual([
      ['change', false],
      ['change', false],
    ]);
  });
});

const REVIEW_TAIL = ['checks', 'agent_review', 'your_review', 'pull_request', 'merge'] as const;

function compose(harness: Harness, taskId: string, steps: PipelineStep[], reason = 'Find the cause first.') {
  harness.send({ type: 'agent.reshape', runId: harness.activeRun(taskId).id, steps, reason });
}

function listSteps(harness: Harness, taskId: string) {
  return resolveTaskProgress(harness.task(taskId)).phases.map((phase) => `${phase.title}:${phase.status}`);
}

describe('the agent composes the steps', () => {
  test('investigate, your OK, then an operation: the diagnosis waits for your OK before the operation is planned', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'The nightly export stalls. Clear whatever is stuck.' });
    expect(harness.activeRun(taskId).prompt).toContain('`steps`');
    compose(
      harness,
      taskId,
      ['investigate', 'your_ok', 'plan', 'operate'],
      'Find what is stuck, then clear it.'
    );
    expect(harness.task(taskId)).toMatchObject({
      pipeline: ['investigate', 'your_ok', 'plan', 'operate'],
      stage: 'triage',
      stageReason: 'verifying the setup',
    });
    expect(harness.task(taskId).activity.find((entry) => entry.kind === 'shape')).toMatchObject({
      text: 'Turned into an investigation, then an operation',
      detail: 'Find what is stuck, then clear it.',
    });
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId).role).toBe('investigator');
    expect(harness.activeRun(taskId).prompt).toContain('goes on to the operation');
    expect(listSteps(harness, taskId)).toEqual([
      'Find the repository:done',
      'Investigate:active',
      'Your OK to run:pending',
      'Plan:pending',
      'Run the operation:pending',
    ]);
    deliver(harness, taskId, 'investigate');
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      type: 'proposal',
      title: 'Run an operation from this diagnosis?',
      body: 'Find what is stuck, then clear it.\n\nPlan the operation. You approve the plan before anything runs.',
    });
    expect(harness.task(taskId)).toMatchObject({ stage: 'awaiting_proposal', proposal: { status: 'open' } });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Proposed running an operation');
    expect(listSteps(harness, taskId)[2]).toBe('Your OK to run:waiting');
    approve(harness, taskId);
    expect(harness.task(taskId).proposal?.status).toBe('accepted');
    expect(harness.task(taskId).stageReason).toBe('verifying the setup');
    passSetup(harness, taskId);
    const planner = harness.activeRun(taskId);
    expect(planner).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(planner.prompt).not.toContain('`reshape_task`');
    expect(planner.prompt).toContain('The human approved going on after that:');
    proposePlan(harness, taskId);
    expect(harness.openGate(taskId).type).toBe('plan');
    approve(harness, taskId);
    deliver(harness, taskId, 'operate');
    expect(harness.task(taskId)).toMatchObject({ stage: 'done', pullRequest: null });
    expect(listSteps(harness, taskId).every((step) => step.endsWith(':done'))).toBe(true);
  });

  test('research, your OK, then a change: the report is in the agent’s prompt and the change ends at your review', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Pick a queue library and switch to it' });
    compose(harness, taskId, ['research', 'your_ok', 'plan', 'build', ...REVIEW_TAIL], 'Compare first.');
    expect(harness.activeRun(taskId).role).toBe('researcher');
    expect(harness.activeRun(taskId).prompt).toContain('goes on to the change');
    deliver(harness, taskId, 'research');
    expect(harness.openGate(taskId).title).toBe('Turn this report into a change?');
    approve(harness, taskId);
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId).prompt).toContain('The report written for this task:');
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    expect(harness.task(taskId).stage).toBe('awaiting_review');
    expect(listSteps(harness, taskId).slice(0, 3)).toEqual([
      'Find the repository:done',
      'Research:done',
      'Your OK to change:done',
    ]);
  });

  test('your veto keeps the diagnosis and finishes the task as an investigation that takes follow-ups', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    compose(harness, taskId, ['investigate', 'your_ok', 'plan', 'build', ...REVIEW_TAIL]);
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate', PROPOSAL);
    expect(harness.openGate(taskId)).toMatchObject({
      title: 'Turn this investigation into a fix?',
      body: `${PROPOSAL.why}\n\n${PROPOSAL.request}`,
    });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reject',
      response: null,
    });
    const task = harness.task(taskId);
    expect(task).toMatchObject({
      stage: 'done',
      stageReason: 'kept as an investigation',
      pipeline: ['investigate'],
      proposal: { status: 'declined' },
      result: { step: 'investigate' },
    });
    expect(acceptsFollowUp(task)).toBe(true);
  });

  test('a message at your OK goes back to the investigator, and its next diagnosis asks again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    compose(harness, taskId, ['investigate', 'your_ok', 'plan', 'operate']);
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate');
    harness.send({ type: 'message.deliver', taskId, text: 'Check the staging pool too.' });
    expect(harness.activeRun(taskId).role).toBe('investigator');
    expect(harness.task(taskId).proposal?.status).toBe('declined');
    expect(() =>
      harness.send({
        type: 'agent.deliver',
        runId: harness.activeRun(taskId).id,
        step: 'investigate',
        body: 'The pool.',
      })
    ).toThrow('This `report_diagnosis` answers a message the human sent');
    deliver(harness, taskId, 'investigate');
    expect(harness.task(taskId).iterations?.[0]).toMatchObject({
      requests: [expect.objectContaining({ text: 'Check the staging pool too.' })],
      reply: REPLY,
    });
    expect(harness.task(taskId)).toMatchObject({ stage: 'awaiting_proposal', proposal: { status: 'open' } });
    expect(resolveNextStep(harness.task(taskId))).toBe('your_ok');
  });

  test('refuses steps that break the rules, names every problem and keeps the agent running', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId);
    const refuse = (steps: PipelineStep[]) => () => compose(harness, taskId, steps);
    expect(refuse(['plan', 'build', 'checks', 'agent_review', 'pull_request', 'merge'])).toThrow(
      'A code change goes through your review, a pull request and the merge. A pull request opens only after your review.'
    );
    expect(refuse(['plan', 'build', 'operate', ...REVIEW_TAIL])).toThrow(
      'An operation runs right after the plan, or after the merge, before your steps after it.'
    );
    expect(refuse(['plan', 'build', 'checks', 'agent_review', 'your_review', 'merge'])).toThrow(
      'A merge needs a pull request first.'
    );
    expect(refuse(['investigate', 'plan', 'build', ...REVIEW_TAIL])).toThrow(
      "An investigation turns into a change or an operation only with the human's OK: put `your_ok` between `investigate` and `plan`."
    );
    expect(refuse(['your_ok', 'plan', 'operate'])).toThrow(
      'Your OK follows an answer, research or an investigation.'
    );
    expect(harness.activeRun(taskId).id).toBe(planner.id);
    compose(harness, taskId, [...SHAPE_PIPELINES.change]);
    expect(harness.activeRun(taskId).id).toBe(planner.id);
    expect(harness.task(taskId).shapeChanges ?? []).toHaveLength(0);
  });

  test('keeps an inquiry that already ran, and composes only once', () => {
    const harness = createHarness();
    const taskId = start(harness, { triage: { shape: 'fix' } });
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate');
    ready(harness, taskId);
    expect(() => compose(harness, taskId, ['research', 'your_ok', 'plan', 'operate'])).toThrow(
      'An investigation already ran, so `investigate` stays in the steps.'
    );
    compose(harness, taskId, ['investigate', 'plan', 'operate'], 'The findings call for a cleanup script.');
    expect(harness.task(taskId)).toMatchObject({ stage: 'triage', stageReason: 'verifying the setup' });
    passSetup(harness, taskId);
    const planner = harness.activeRun(taskId);
    expect(planner.prompt).not.toContain('`reshape_task`');
    expect(() => compose(harness, taskId, ['investigate'])).toThrow(
      'The steps of this task are already set.'
    );
  });

  test('the agent that composes your OK after findings already in asks for it before planning', () => {
    const harness = createHarness();
    const taskId = start(harness, { triage: { shape: 'fix' } });
    passSetup(harness, taskId);
    deliver(harness, taskId, 'investigate');
    ready(harness, taskId);
    compose(
      harness,
      taskId,
      ['investigate', 'your_ok', 'plan', 'build', ...REVIEW_TAIL],
      'Check with the human.'
    );
    expect(harness.task(taskId)).toMatchObject({ stage: 'awaiting_proposal', proposal: { status: 'open' } });
    expect(harness.openGate(taskId).body).toBe(
      'Check with the human.\n\nPlan the change and build it. You review it before a pull request opens.'
    );
  });

  test('an answer can lead to an operation, and approving plans it without asking for another proposal', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    compose(harness, taskId, ['answer', 'your_ok', 'plan', 'operate']);
    passSetup(harness, taskId);
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'answer',
      body: 'It is stuck.',
    });
    expect(harness.openGate(taskId)).toMatchObject({
      title: 'Run an operation from this answer?',
      body: 'Find the cause first.\n\nPlan the operation. You approve the plan before anything runs.',
    });
    const proposed = harness.events.filter((event) => event.type === 'task.change_proposed').length;
    approve(harness, taskId);
    expect(harness.events.filter((event) => event.type === 'task.change_proposed')).toHaveLength(proposed);
    expect(harness.task(taskId)).toMatchObject({ stage: 'triage', stageReason: 'verifying the setup' });
  });
});

const BACKFILL = [
  'Run `bun scripts/backfill-plans.ts --dry-run` and check it lists every account without a plan.',
  'Run it without `--dry-run` and check the count of accounts without a plan is 0.',
];

function planWithOperation(harness: Harness, taskId: string) {
  proposePlan(harness, taskId, { ...PLAN, operation: BACKFILL });
}

function reachMergedPullRequest(harness: Harness, taskId: string) {
  completePhase(harness, taskId);
  completePhase(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings: [],
  });
  approve(harness, taskId);
  pushed(harness, taskId);
  harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest({ state: 'merged', mergeCommit: 'f00dfacecafe' }),
  });
}

describe('a change, then an operation', () => {
  test('builds, ships and merges the change, then runs the operation on the merged code and finishes', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Add a plan column and backfill it' });
    compose(harness, taskId, [...SHAPE_PIPELINES.change, 'operate'], 'The column needs data once it ships.');
    expect(harness.task(taskId).activity.find((entry) => entry.kind === 'shape')?.text).toBe(
      'Turned into a change, then an operation'
    );
    const planner = harness.activeRun(taskId);
    expect(planner).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(planner.prompt).toContain('then you run the operation on the merged code');
    expect(() => proposePlan(harness, taskId)).toThrow(
      'This task also runs an operation: list its steps in `operation`'
    );
    expect(harness.activeRun(taskId).id).toBe(planner.id);
    planWithOperation(harness, taskId);
    expect(harness.openGate(taskId)).toMatchObject({ type: 'plan' });
    expect(harness.openGate(taskId).body).toContain(`## Operation\n1. ${BACKFILL[0]}`);
    approve(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build' });
    expect(harness.activeRun(taskId).prompt).toContain(
      "Do not run the plan's operation yet: you run it after the pull request merges and the human confirms it."
    );
    reachMergedPullRequest(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({ stage: 'awaiting_operation' });
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(harness.openGate(taskId)).toMatchObject({
      type: 'operation',
      title: 'The change merged. Run the operation now?',
      commit: 'f00dfacecafe',
    });
    expect(harness.openGate(taskId).body).toContain('Pull request #42 merged as `f00dfac`.');
    expect(harness.openGate(taskId).body).toContain(`## Operation\n1. ${BACKFILL[0]}`);
    expect(harness.openGate(taskId).body).toContain(`## Impact\n${IMPACT}`);
    expect(listSteps(harness, taskId).at(-1)).toBe('Run the operation:waiting');
    approve(harness, taskId);
    const operator = harness.activeRun(taskId);
    expect(operator).toMatchObject({ role: 'agent', purpose: 'operate' });
    expect(operator.prompt).toContain('has merged into the default branch');
    expect(operator.prompt).toContain(`The impact the human approved:\n${IMPACT}`);
    expect(operator.prompt).toContain(`The operation to run:\n1. ${BACKFILL[0]}\n2. ${BACKFILL[1]}`);
    expect(harness.task(taskId)).toMatchObject({ stage: 'operating', pullRequest: { state: 'merged' } });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(listSteps(harness, taskId).slice(-3)).toEqual([
      'Pull request:done',
      'Merge:done',
      'Run the operation:active',
    ]);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'open' }) });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    expect(harness.activeRun(taskId).id).toBe(operator.id);
    expect(harness.task(taskId).pullRequest?.state).toBe('merged');
    deliver(harness, taskId, 'operate');
    expect(harness.task(taskId)).toMatchObject({ stage: 'done', stageReason: 'the operation finished' });
    expect(listSteps(harness, taskId).every((step) => step.endsWith(':done'))).toBe(true);
  });

  test('a paused operation after the merge retries the agent, never the merge', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    compose(harness, taskId, [...SHAPE_PIPELINES.change, 'operate']);
    planWithOperation(harness, taskId);
    approve(harness, taskId);
    reachMergedPullRequest(harness, taskId);
    approve(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Backfill timed out', detail: 'x' });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'operate' });
    expect(harness.task(taskId).stage).toBe('operating');
  });

  test('a merge that arrives while the task is paused clears the pause and runs the operation', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    compose(harness, taskId, [...SHAPE_PIPELINES.change, 'operate']);
    planWithOperation(harness, taskId);
    approve(harness, taskId);
    completePhase(harness, taskId);
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    approve(harness, taskId);
    pushed(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Could not read the pull request', detail: 'x' });
    expect(harness.openGate(taskId).type).toBe('failure');
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.type)).toEqual(['operation']);
    expect(harness.openGate(taskId).body).toMatch(/^Pull request #42 merged\. The merged code/);
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });

  test('an operation can run first, and the change is built after it', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Snapshot the table, then drop the old column' });
    compose(harness, taskId, ['plan', 'operate', ...SHAPE_PIPELINES.change.slice(1)], 'Snapshot first.');
    passSetup(harness, taskId);
    expect(harness.activeRun(taskId).prompt).toContain('This task runs an operation first');
    expect(() => proposePlan(harness, taskId, { ...PLAN, impact: IMPACT })).toThrow(
      'This task also runs an operation: list its steps in `operation`'
    );
    planWithOperation(harness, taskId);
    approve(harness, taskId);
    const operator = harness.activeRun(taskId);
    expect(operator).toMatchObject({ role: 'agent', purpose: 'operate' });
    expect(operator.prompt).toContain('You build the code change in the plan after it');
    deliver(harness, taskId, 'operate');
    expect(harness.task(taskId).stage).toBe('building');
    expect(harness.activeRun(taskId).prompt).toContain('How the operation went:');
    reachMergedPullRequest(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({ stage: 'merged', result: { step: 'operate' } });
  });
});

describe('the operation after the merge waits for your OK', () => {
  function reachOperationGate(harness: Harness) {
    const taskId = createTask(harness);
    compose(harness, taskId, [...SHAPE_PIPELINES.change, 'operate']);
    planWithOperation(harness, taskId);
    approve(harness, taskId);
    reachMergedPullRequest(harness, taskId);
    return taskId;
  }

  test('reads as an operation to confirm in Needs you, the guide and the status summary', () => {
    const harness = createHarness();
    const taskId = reachOperationGate(harness);
    const queue = resolveQueue(harness.state, harness.now);
    expect(queue.ready.map((entry) => entry.reason)).toEqual([
      'The change merged and the operation waits for your OK',
    ]);
    expect(resolveFallbackBriefing(queue, harness.now).now?.why).toBe(
      'The change merged, and the operation runs once you confirm it'
    );
    expect(resolveQueueSummary(harness.state, harness.now, 'http://x').decisions[0]?.label).toBe('Operation');
    expect(
      harness.task(taskId).activity.some((entry) => entry.text === 'Merged, ready to run the operation')
    ).toBe(true);
  });

  test('takes your words as guidance for the agent', () => {
    const harness = createHarness();
    const taskId = reachOperationGate(harness);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reply',
      response: 'Run it on staging first.',
    });
    expect(harness.activeRun(taskId).prompt).toContain('Guidance from the human:\nRun it on staging first.');
  });

  test('a message at the operation gate replaces the notes even when it reads as new work', () => {
    const harness = createHarness();
    const taskId = reachOperationGate(harness);
    harness.send({ type: 'task.message', taskId, text: 'Wait for the deploy.', kind: 'new_round' });
    expect(resolveTaskRounds(harness.task(taskId))).toHaveLength(1);
    expect(harness.openGate(taskId).notes).toBe('Wait for the deploy.');
  });

  test('declining finishes the task without running the operation', () => {
    const harness = createHarness();
    const taskId = reachOperationGate(harness);
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: harness.openGate(taskId).id,
        decision: 'revise',
        response: 'x',
      })
    ).toThrow('Run the operation or finish without it.');
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'done',
      stageReason: 'merged without running the operation',
    });
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });

  test('a message replaces the notes for the agent on the same gate, without asking again or running the operation', () => {
    const harness = createHarness();
    const taskId = reachOperationGate(harness);
    const gate = harness.openGate(taskId);
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('operation_notes');
    harness.send({ type: 'task.message', taskId, text: 'Wait for the deploy.' });
    expect(harness.openGate(taskId)).toEqual({ ...gate, notes: 'Wait for the deploy.' });
    harness.send({ type: 'message.deliver', taskId, text: 'Skip the archived accounts.' });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.openGate(taskId)).toEqual({ ...gate, notes: 'Skip the archived accounts.' });
    const again = harness.send({ type: 'message.deliver', taskId, text: '  Skip the archived accounts. ' });
    expect(again.events).toEqual([]);
    expect(harness.task(taskId).stage).toBe('awaiting_operation');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    approve(harness, taskId);
    const prompt = harness.activeRun(taskId).rolePrompt;
    expect(prompt).toContain('Guidance from the human:\nSkip the archived accounts.');
    expect(prompt).not.toContain('Wait for the deploy.');
  });

  test('running with your words replaces the notes a message left', () => {
    const harness = createHarness();
    const taskId = reachOperationGate(harness);
    harness.send({ type: 'task.message', taskId, text: 'Wait for the deploy.' });
    const gateId = harness.openGate(taskId).id;
    harness.send({ type: 'gate.answer', gateId, decision: 'reply', response: ' Run it on staging first. ' });
    expect(harness.state.gates[gateId]?.notes).toBe('Run it on staging first.');
    const prompt = harness.activeRun(taskId).rolePrompt;
    expect(prompt).toContain('Guidance from the human:\nRun it on staging first.');
    expect(prompt).not.toContain('Wait for the deploy.');
  });

  test('running with no words clears the notes, and approving runs with none', () => {
    const cleared = createHarness();
    const taskId = reachOperationGate(cleared);
    cleared.send({ type: 'task.message', taskId, text: 'Wait for the deploy.' });
    const gateId = cleared.openGate(taskId).id;
    const decision = cleared.send({ type: 'gate.answer', gateId, decision: 'reply', response: '  ' });
    expect(decision.events).toContainEqual(
      expect.objectContaining({ type: 'gate.noted', gateId, notes: null })
    );
    expect(cleared.state.gates[gateId]?.notes).toBeNull();
    expect(cleared.activeRun(taskId).prompt).not.toContain('Guidance from the human');

    const bare = createHarness();
    const other = reachOperationGate(bare);
    const ran = bare.send({
      type: 'gate.answer',
      gateId: bare.openGate(other).id,
      decision: 'approve',
      response: null,
    });
    expect(ran.events.map((event) => event.type)).not.toContain('gate.noted');
    expect(bare.activeRun(other).prompt).not.toContain('Guidance from the human');
  });
});

describe('the plan names the work', () => {
  const RETITLED = { ...PLAN, title: 'Fix the tab group scroll and its overflow' };

  function retitledEvents(harness: Harness) {
    return harness.events.filter((event) => event.type === 'task.retitled');
  }

  test('a plan accepted with no gate renames the task and its first round', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId, RETITLED);
    const task = harness.task(taskId);
    expect(task.title).toBe(RETITLED.title);
    expect(resolveTaskRounds(task)[0]?.title).toBe(RETITLED.title);
    expect(task.activity.map((entry) => entry.text)).toContain(`Renamed to “${RETITLED.title}”`);
  });

  test('a plan at the gate renames the task only once you approve it', () => {
    const harness = createHarness();
    registerRepo(harness);
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId, RETITLED);
    expect(harness.task(taskId).title).toBe('Fix tab group scroll');
    approve(harness, taskId);
    expect(harness.task(taskId).title).toBe(RETITLED.title);
  });

  test('a plan without a title, or with the title the round has, keeps it and records nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId, { ...PLAN, title: 'Fix tab group scroll' });
    expect(harness.task(taskId).title).toBe('Fix tab group scroll');
    expect(retitledEvents(harness)).toHaveLength(0);
    const other = createTask(harness);
    proposePlan(harness, other);
    expect(harness.task(other).title).toBe('Fix tab group scroll');
    expect(retitledEvents(harness)).toHaveLength(0);
  });

  test('a revised plan accepted later renames the task again', () => {
    const harness = createHarness();
    registerRepo(harness);
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId, RETITLED);
    harness.send({ type: 'task.message', taskId, text: 'Make it a settings page instead.' });
    proposePlan(harness, taskId, { ...PLAN, title: 'Add the scroll settings page' });
    approve(harness, taskId);
    expect(harness.task(taskId).title).toBe('Add the scroll settings page');
    expect(retitledEvents(harness)).toHaveLength(1);
  });

  test('a later round renames only itself, never the task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    shipAndMerge(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Now add the settings page', kind: 'new_round' });
    harness.send({ type: 'config.record', taskId, problems: [] });
    const task = harness.task(taskId);
    if (task.stage === 'triage' && task.branch) {
      harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: task.branch });
    }
    proposePlan(harness, taskId, { ...PLAN, title: 'Add the scroll settings page' });
    const renamed = harness.task(taskId);
    expect(renamed.title).toBe('Fix tab group scroll');
    expect(resolveTaskRounds(renamed).map((round) => round.title)).toEqual([
      'Fix tab group scroll',
      'Add the scroll settings page',
    ]);
  });
});
