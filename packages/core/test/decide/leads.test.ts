import { describe, expect, test } from 'bun:test';
import {
  INITIATIVE_LIMITS,
  listInitiatives,
  listOpenGates,
  resolveInitiativeSheet,
  resolveRunBrief,
  resolveTaskPipeline,
  validateComposition,
  validatePipeline,
} from '../../src/index.ts';
import {
  approve,
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  readInstruction,
  registerRepo,
  shipAndMerge,
  verifySetup,
} from '../harness.ts';

function writeInitiative(harness: Harness, name = 'Chat split') {
  harness.send({
    type: 'initiative.write',
    initiativeId: null,
    name,
    description: 'Restart the chat stack as small pull requests.',
    phases: [{ id: null, name: 'Dock' }],
  });
  return listInitiatives(harness.state).at(-1)?.id ?? '';
}

function initiativeOf(harness: Harness, id: string) {
  const initiative = harness.state.initiatives[id];
  if (!initiative) throw new Error(`no initiative ${id}`);
  return initiative;
}

function triageLead(harness: Harness, taskId: string) {
  const repoId = Object.keys(harness.state.repos)[0] ?? registerRepo(harness);
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Lead the chat split',
    repoId: null,
    size: 'small',
    branch: `lead/${taskId}`,
    waitsOn: [],
  });
  if (harness.task(taskId).stage === 'triage') verifySetup(harness, taskId);
  return repoId;
}

function startLead(harness: Harness, initiativeId: string, forkOf: string | null = null) {
  harness.send({ type: 'initiative.start_lead', initiativeId, forkOf });
  const leadId = initiativeOf(harness, initiativeId).leadTaskId ?? '';
  triageLead(harness, leadId);
  return leadId;
}

function report(
  harness: Harness,
  leadId: string,
  narrative = 'Dock is in review.',
  questions: string[] = []
) {
  harness.send({
    type: 'agent.report_initiative',
    runId: harness.activeRun(leadId).id,
    narrative,
    questions,
  });
}

function refusal(harness: Harness, command: Parameters<Harness['send']>[0]) {
  try {
    harness.send(command);
  } catch (error) {
    return { code: (error as { code?: string }).code, message: (error as Error).message };
  }
  throw new Error('expected a refusal');
}

function ledInitiative() {
  const harness = createHarness();
  registerRepo(harness);
  const initiativeId = writeInitiative(harness);
  const leadId = startLead(harness, initiativeId);
  return { harness, initiativeId, leadId };
}

function addMember(harness: Harness, initiativeId: string, request = 'Rewrite the dock') {
  const taskId = createTask(harness, { request });
  harness.send({ type: 'task.join_initiative', taskId, initiativeId, phaseId: null });
  return taskId;
}

describe('starting a lead', () => {
  test('files a lead task in the initiative that leads on its own step', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const lead = harness.task(leadId);
    expect(resolveTaskPipeline(lead)).toEqual(['lead']);
    expect(lead.initiativeId).toBe(initiativeId);
    expect(lead.stage).toBe('leading');
    const run = harness.activeRun(leadId);
    expect(run).toMatchObject({ role: 'agent', purpose: 'lead' });
    const prompt = readInstruction(run);
    expect(prompt).toContain('Shinsa started you to lead the initiative “Chat split”.');
    expect(prompt).toContain('Restart the chat stack as small pull requests.');
    expect(prompt).toContain('Its phases, in order: Dock.');
    expect(prompt).toContain('The initiative has no tasks yet.');
    expect(prompt).toContain('`report_initiative`');
    expect(run.prompt).not.toContain('Your role: the agent for this task');
    expect(run.prompt).not.toContain('git status');
    expect(resolveRunBrief(harness.state, { ...run, resume: true })).not.toContain('git status');
  });

  test('refuses a second live lead, and starts a new one once the first is done', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    expect(refusal(harness, { type: 'initiative.start_lead', initiativeId, forkOf: null }).code).toBe(
      'lead_exists'
    );
    report(harness, leadId);
    harness.send({ type: 'task.complete', taskId: leadId });
    const next = startLead(harness, initiativeId);
    expect(next).not.toBe(leadId);
    expect(harness.task(next).stage).toBe('leading');
  });

  test('forks the lead from a task, so it starts from that conversation', () => {
    const harness = createHarness();
    registerRepo(harness);
    const initiativeId = writeInitiative(harness);
    const source = createTask(harness, { request: 'Rewrite the dock as PR 1' });
    const leadId = startLead(harness, initiativeId, source);
    expect(harness.task(leadId).forkOf).toBe(source);
  });
});

describe('the lead’s report', () => {
  test('stores the narrative and questions and keeps the lead leading', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const runId = harness.activeRun(leadId).id;
    report(harness, leadId, '  Dock is in review.  ', [' Merge SW-103 first? ']);
    expect(initiativeOf(harness, initiativeId).report).toMatchObject({
      narrative: 'Dock is in review.',
      questions: ['Merge SW-103 first?'],
      runId,
    });
    expect(harness.state.runs[runId]?.outcome).toBe('completed');
    expect(harness.task(leadId).stage).toBe('leading');
  });

  test('refuses an empty or oversized report', () => {
    const { harness, leadId } = ledInitiative();
    const runId = harness.activeRun(leadId).id;
    const send = (narrative: string, questions: string[]) =>
      refusal(harness, { type: 'agent.report_initiative', runId, narrative, questions });
    expect(send(' ', []).message).toBe('narrative is required.');
    expect(send('x'.repeat(INITIATIVE_LIMITS.narrative + 1), []).message).toBe(
      `narrative is ${INITIATIVE_LIMITS.narrative + 1} characters; the limit is ${INITIATIVE_LIMITS.narrative}.`
    );
    expect(send('ok', ['a', 'b', 'c', 'd', 'e', 'f']).code).toBe('report_invalid');
    expect(send('ok', ['ok', 'x'.repeat(INITIATIVE_LIMITS.question + 1)]).message).toContain('questions[1]');
  });

  test('refuses the report outside a lead turn', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    const refused = refusal(harness, {
      type: 'agent.report_initiative',
      runId,
      narrative: 'x',
      questions: [],
    });
    expect(refused.code).toBe('wrong_step');
  });

  test('refuses the report once its initiative is gone', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const runId = harness.activeRun(leadId).id;
    harness.send({ type: 'initiative.remove', initiativeId });
    const refused = refusal(harness, {
      type: 'agent.report_initiative',
      runId,
      narrative: 'x',
      questions: [],
    });
    expect(refused.code).toBe('initiative_not_found');
  });
});

describe('member milestones', () => {
  test('queue on the initiative and ask for a wake', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    const memberId = addMember(harness, initiativeId);
    expect(initiativeOf(harness, initiativeId).milestones).toMatchObject([
      { taskId: memberId, kind: 'joined', text: '' },
    ]);
    expect(harness.lastEffect('initiative.wake')).toEqual({ kind: 'initiative.wake', initiativeId });
  });

  test('record a gate opening, an approved plan and a merge', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    const memberId = addMember(harness, initiativeId);
    shipAndMerge(harness, memberId);
    const kinds = (initiativeOf(harness, initiativeId).milestones ?? []).map((milestone) => milestone.kind);
    expect(kinds).toContain('gate_opened');
    expect(kinds).toContain('plan_approved');
    expect(kinds).toContain('merged');
    expect(kinds.at(0)).toBe('joined');
  });

  test('record a plan you approved at its gate', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    const memberId = createTask(harness, { request: 'Rewrite the dock', planFirst: true });
    harness.send({ type: 'task.join_initiative', taskId: memberId, initiativeId, phaseId: null });
    proposePlan(harness, memberId);
    approve(harness, memberId);
    const approved = (initiativeOf(harness, initiativeId).milestones ?? []).filter(
      (milestone) => milestone.kind === 'plan_approved'
    );
    expect(approved).toHaveLength(1);
  });

  test('record a member filed straight into the initiative and its cancellation', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    const repoId = Object.keys(harness.state.repos)[0] ?? '';
    harness.send({ type: 'task.create', request: 'Archive chats\nfrom the menu', repoId, initiativeId });
    const memberId = Object.keys(harness.state.tasks).at(-1) ?? '';
    harness.send({ type: 'task.cancel', taskId: memberId });
    expect(initiativeOf(harness, initiativeId).milestones).toMatchObject([
      { taskId: memberId, kind: 'joined', text: 'Archive chats' },
      { taskId: memberId, kind: 'cancelled' },
    ]);
  });

  test('skip the lead itself, tasks it filed and initiatives with no live lead', () => {
    const harness = createHarness();
    registerRepo(harness);
    const initiativeId = writeInitiative(harness);
    addMember(harness, initiativeId);
    expect(initiativeOf(harness, initiativeId).milestones).toBeUndefined();
    const leadId = startLead(harness, initiativeId);
    expect(initiativeOf(harness, initiativeId).milestones ?? []).toEqual([]);
    harness.send({
      type: 'agent.create_task',
      runId: harness.activeRun(leadId).id,
      requestKey: 'next-piece',
      request: 'Port the studio',
      repoId: null,
      thisWaits: false,
    });
    const filedId = Object.keys(harness.state.tasks).at(-1) ?? '';
    expect(harness.task(filedId).initiativeId).toBe(initiativeId);
    expect(initiativeOf(harness, initiativeId).milestones ?? []).toEqual([]);
  });

  test('clip long texts to one short line', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    const repoId = Object.keys(harness.state.repos)[0] ?? '';
    harness.send({ type: 'task.create', request: 'x'.repeat(400), repoId, initiativeId });
    const text = initiativeOf(harness, initiativeId).milestones?.[0]?.text ?? '';
    expect(text).toHaveLength(280);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('waking the lead', () => {
  test('starts a turn with the milestones and clears the queue', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    const memberId = addMember(harness, initiativeId, 'Rewrite the dock');
    harness.send({ type: 'initiative.wake_lead', initiativeId });
    const prompt = readInstruction(harness.activeRun(leadId));
    expect(prompt).toContain('Shinsa woke you because members of the initiative “Chat split” moved on.');
    expect(prompt).toContain('What happened since your last turn:');
    expect(prompt).toContain(`(shinsa://task/${memberId}) joined the initiative`);
    expect(prompt).toContain('Working now:');
    expect(initiativeOf(harness, initiativeId).milestones).toEqual([]);
  });

  test('does nothing while the lead works, and asks again after its report', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const runId = harness.activeRun(leadId).id;
    addMember(harness, initiativeId);
    harness.send({ type: 'initiative.wake_lead', initiativeId });
    expect(harness.activeRun(leadId).id).toBe(runId);
    const wakes = harness.effectsOf('initiative.wake').length;
    report(harness, leadId);
    expect(harness.effectsOf('initiative.wake')).toHaveLength(wakes + 1);
  });

  test('does nothing without milestones, a lead or the initiative', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    const events = harness.events.length;
    harness.send({ type: 'initiative.wake_lead', initiativeId });
    harness.send({ type: 'initiative.wake_lead', initiativeId: 'gone' });
    expect(harness.events).toHaveLength(events);
    addMember(harness, initiativeId);
    harness.send({ type: 'task.complete', taskId: leadId });
    const settled = harness.events.length;
    harness.send({ type: 'initiative.wake_lead', initiativeId });
    expect(harness.events).toHaveLength(settled);
  });

  test('settles the lead when its initiative is gone', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    harness.send({ type: 'initiative.remove', initiativeId });
    harness.send({ type: 'task.message', taskId: leadId, text: 'What is next?' });
    expect(harness.task(leadId).stage).toBe('done');
  });
});

describe('talking to the lead', () => {
  test('a message to an idle lead starts a turn with it', () => {
    const { harness, leadId } = ledInitiative();
    report(harness, leadId);
    harness.send({ type: 'task.message', taskId: leadId, text: 'Why was SW-110 dropped?' });
    const prompt = readInstruction(harness.activeRun(leadId));
    expect(prompt).toContain('The human wrote to you about the initiative “Chat split”.');
    expect(prompt).toContain('The human wrote: Why was SW-110 dropped?');
  });

  test('a lead turn that ends without its report resumes, and retry restarts it', () => {
    const { harness, leadId } = ledInitiative();
    const first = harness.activeRun(leadId);
    harness.send({ type: 'run.end', runId: first.id, outcome: 'completed', summary: null });
    const second = harness.activeRun(leadId);
    expect(second.id).not.toBe(first.id);
    expect(second.purpose).toBe('lead');
    while (!harness.state.gates || listOpenGates(harness.state, leadId).length === 0) {
      harness.send({
        type: 'run.end',
        runId: harness.activeRun(leadId).id,
        outcome: 'completed',
        summary: null,
      });
    }
    expect(harness.openGate(leadId).type).toBe('failure');
    harness.send({ type: 'task.retry', taskId: leadId });
    expect(harness.activeRun(leadId).purpose).toBe('lead');
  });

  test('a member’s brief names its initiative and its lead', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const phaseId = initiativeOf(harness, initiativeId).phases[0]?.id ?? '';
    const repoId = Object.keys(harness.state.repos)[0] ?? '';
    harness.send({
      type: 'task.create',
      request: 'Dock host',
      repoId,
      initiativeId,
      initiativePhaseId: phaseId,
    });
    const memberId = Object.keys(harness.state.tasks).at(-1) ?? '';
    harness.send({
      type: 'task.triage',
      taskId: memberId,
      title: 'Dock host',
      repoId,
      size: 'small',
      branch: 'fix/dock',
      waitsOn: [],
    });
    verifySetup(harness, memberId);
    harness.send({ type: 'worktree.ready', taskId: memberId, path: '/wt/dock', branch: 'fix/dock' });
    const prompt = harness.activeRun(memberId).prompt ?? '';
    expect(prompt).toContain('This task is part of the initiative “Chat split”, in its phase “Dock”.');
    expect(prompt).toContain(`Its lead is [Lead the chat split](shinsa://task/${leadId})`);
  });

  test('a member without a live lead is told only its initiative', () => {
    const harness = createHarness();
    registerRepo(harness);
    const initiativeId = writeInitiative(harness);
    const repoId = Object.keys(harness.state.repos)[0] ?? '';
    harness.send({ type: 'task.create', request: 'Dock host', repoId, initiativeId });
    const memberId = Object.keys(harness.state.tasks).at(-1) ?? '';
    harness.send({
      type: 'task.triage',
      taskId: memberId,
      title: 'Dock host',
      repoId,
      size: 'small',
      branch: 'fix/dock',
      waitsOn: [],
    });
    verifySetup(harness, memberId);
    harness.send({ type: 'worktree.ready', taskId: memberId, path: '/wt/dock', branch: 'fix/dock' });
    const prompt = harness.activeRun(memberId).prompt ?? '';
    expect(prompt).toContain('This task is part of the initiative “Chat split”.');
    expect(prompt).not.toContain('Its lead is');
  });
});

describe('the lead in the sheet and the rules', () => {
  test('the sheet leaves the lead out of every section', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const memberId = addMember(harness, initiativeId);
    const sheet = resolveInitiativeSheet(harness.state, initiativeId, harness.now);
    expect(sheet?.now.map((task) => task.id)).toEqual([memberId]);
    expect(sheet?.now.map((task) => task.id)).not.toContain(leadId);
  });

  test('a lead stands alone and only Shinsa composes it', () => {
    expect(validatePipeline(['lead', 'answer'])).toContain(
      'A lead does nothing but lead its initiative, so it has no other step.'
    );
    expect(validatePipeline(['lead'])).toEqual([]);
    expect(
      validateComposition({ pipeline: ['plan', 'build'], mode: 'build', result: null }, ['lead'])
    ).toContain('Only Shinsa starts a lead, for an initiative.');
  });
});
