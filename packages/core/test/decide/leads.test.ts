import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  INITIATIVE_LIMITS,
  listActiveRuns,
  listInitiatives,
  listInitiativeWork,
  listOpenGates,
  needsRepository,
  resolveInitiativeSheet,
  resolveRunBrief,
  resolveTaskPipeline,
  selectInitiativeLead,
  validateComposition,
  validatePipeline,
} from '../../src/index.ts';
import {
  approve,
  createHarness,
  createInitiative,
  createTask,
  fireRetry,
  type Harness,
  planLead,
  proposePlan,
  readInstruction,
  registerRepo,
  shipAndMerge,
  spendRetries,
  verifySetup,
} from '../harness.ts';

function startInitiative(harness: Harness) {
  const created = createInitiative(harness, {
    description: 'Restart the chat stack as small pull requests.',
    phases: ['Dock'],
  });
  triageLead(harness, created.leadId);
  return created;
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
  if (harness.task(taskId).stage === 'planning') planLead(harness, taskId);
  return repoId;
}

function report(harness: Harness, leadId: string, narrative = 'Dock is in review.') {
  harness.send({ type: 'agent.report_initiative', runId: harness.activeRun(leadId).id, narrative });
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
  const { initiativeId, leadId } = startInitiative(harness);
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
    expect(resolveTaskPipeline(lead)).toEqual(['plan', 'lead']);
    expect(lead.initiativeId).toBe(initiativeId);
    expect(lead.stage).toBe('leading');
    const run = harness.activeRun(leadId);
    expect(run).toMatchObject({ role: 'agent', purpose: 'lead' });
    const prompt = readInstruction(run);
    expect(prompt).toContain('Shinsa started you to lead the initiative “Chat split”.');
    expect(prompt).toContain('Restart the chat stack as small pull requests.');
    expect(prompt).toContain('Its phases, in order: Dock, Wrap up.');
    expect(prompt).toContain('The initiative has no tasks yet.');
    expect(prompt).toContain('`report_initiative`');
    expect(run.prompt).not.toContain('Your role: the agent for this task');
    expect(run.prompt).not.toContain('git status');
    expect(resolveRunBrief(harness.state, { ...run, resume: true })).not.toContain('git status');
  });

  test('marking the lead done finishes the initiative and keeps its record', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    harness.send({ type: 'task.complete', taskId: leadId });
    expect(
      Option.getOrNull(selectInitiativeLead(harness.state, initiativeOf(harness, initiativeId)))
    ).toBeNull();
    expect(initiativeOf(harness, initiativeId).report?.narrative).toBe('Dock is in review.');
  });

  test('never counts a lead, live or finished, as the initiative’s work', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const member = addMember(harness, initiativeId);
    report(harness, leadId);
    harness.send({ type: 'task.complete', taskId: leadId });
    expect(listInitiativeWork(harness.state, initiativeId).map((task) => task.id)).toEqual([member]);
    const sheet = Option.getOrNull(resolveInitiativeSheet(harness.state, initiativeId, harness.now));
    expect(sheet?.progress.reduce((sum, phase) => sum + phase.total, 0)).toBe(1);
    expect(sheet?.shipped.map((task) => task.id)).not.toContain(leadId);
  });

  test('finds no lead when the initiative names none, or names a task that is not a lead', () => {
    const { harness, initiativeId } = ledInitiative();
    expect(Option.getOrNull(selectInitiativeLead(harness.state, { leadTaskId: null }))).toBeNull();
    const member = addMember(harness, initiativeId);
    expect(Option.getOrNull(selectInitiativeLead(harness.state, { leadTaskId: member }))).toBeNull();
    expect(Option.getOrNull(selectInitiativeLead(harness.state, { leadTaskId: 'gone' }))).toBeNull();
  });

  test('making an initiative from a task forks its lead from that task’s conversation', () => {
    const harness = createHarness();
    registerRepo(harness);
    const source = createTask(harness, { request: 'Rewrite the dock as PR 1' });
    harness.send({ type: 'initiative.adopt_task', taskId: source });
    const initiative = listInitiatives(harness.state).at(-1);
    const lead = harness.task(initiative?.leadTaskId ?? '');
    expect(lead.forkOf).toBe(source);
    expect(resolveTaskPipeline(lead)).toEqual(['lead']);
    expect(lead.request).toContain('Lead the initiative “Rewrite the dock as PR 1”');
  });

  test('an adopted lead starts leading once triaged, with no plan first', () => {
    const harness = createHarness();
    registerRepo(harness);
    const source = createTask(harness, { request: 'Rewrite the dock as PR 1' });
    harness.send({ type: 'initiative.adopt_task', taskId: source });
    const leadId = listInitiatives(harness.state).at(-1)?.leadTaskId ?? '';
    triageLead(harness, leadId);
    expect(harness.activeRun(leadId)).toMatchObject({ role: 'agent', purpose: 'lead' });
  });
});

describe('planning the initiative', () => {
  function plannedHarness() {
    const harness = createHarness();
    registerRepo(harness);
    const { initiativeId, leadId } = createInitiative(harness);
    harness.send({
      type: 'task.triage',
      taskId: leadId,
      title: 'Lead the chat split',
      repoId: null,
      size: 'small',
      branch: `lead/${leadId}`,
      waitsOn: [],
    });
    if (harness.task(leadId).stage === 'triage') verifySetup(harness, leadId);
    return { harness, initiativeId, leadId };
  }

  test('a new lead plans the initiative first, without a repository', () => {
    const { harness, leadId } = plannedHarness();
    expect(harness.task(leadId).stage).toBe('planning');
    const run = harness.activeRun(leadId);
    expect(run).toMatchObject({ role: 'agent', purpose: 'plan' });
    const prompt = readInstruction(run);
    expect(prompt).toContain('Your role: the lead of this initiative');
    expect(prompt).toContain('`split`: the first tasks to file');
    expect(prompt).toContain('`files` and `verification` stay empty');
  });

  test('approving the plan files its tasks in their phases, then the lead reports', () => {
    const { harness, initiativeId, leadId } = plannedHarness();
    planLead(harness, leadId, [
      { title: 'Dock', request: 'In pwn, rewrite the dock.', order: 'parallel', phase: 1 },
      { title: 'Tools', request: 'In embedded, add the tools.', order: 'waits_on', on: 1, phase: 2 },
      { title: 'Docs', request: 'In pwn, write the docs.', order: 'parallel' },
    ]);
    const initiative = initiativeOf(harness, initiativeId);
    expect(initiative.phases.map((phase) => phase.name)).toEqual(['Start', 'Wrap up']);
    const filed = listInitiativeWork(harness.state, initiativeId);
    expect(filed.map((task) => task.request)).toEqual([
      'In pwn, rewrite the dock.',
      'In embedded, add the tools.',
      'In pwn, write the docs.',
    ]);
    expect(filed.map((task) => task.initiativePhaseId ?? null)).toEqual([
      initiative.phases[0]?.id ?? 'missing',
      initiative.phases[1]?.id ?? 'missing',
      null,
    ]);
    expect(filed[1]?.waitsOn).toEqual([filed[0]?.id ?? 'missing']);
    expect(harness.task(leadId).stage).toBe('leading');
    expect(harness.activeRun(leadId).purpose).toBe('lead');
    expect(initiative.milestones ?? []).toEqual([]);
  });

  test('keeps phases written before the plan and adds only the new ones', () => {
    const { harness, initiativeId, leadId } = plannedHarness();
    harness.send({
      type: 'initiative.write',
      initiativeId,
      name: 'Chat split',
      phases: [{ id: null, name: 'Start' }],
    });
    const kept = initiativeOf(harness, initiativeId).phases[0]?.id;
    planLead(harness, leadId);
    expect(
      initiativeOf(harness, initiativeId).phases.map((phase) => [phase.id === kept, phase.name])
    ).toEqual([
      [true, 'Start'],
      [false, 'Wrap up'],
    ]);
  });

  test('a lead plan may split but changes no files and starts no initiative of its own', () => {
    const { harness, leadId } = plannedHarness();
    const runId = harness.activeRun(leadId).id;
    const refused = refusal(harness, {
      type: 'agent.propose_plan',
      runId,
      document: {
        goal: 'Ship it.',
        phases: [
          { title: 'Start', detail: 'Start.' },
          { title: 'End', detail: 'End.' },
        ],
        behaviour: [],
        approach: 'Carefully.',
        files: [{ path: 'src/a.ts', change: 'Edit.' }],
        outOfScope: [],
        verification: [],
        questions: [],
        initiative: true,
        split: [{ title: 'A', request: 'Do A.', order: 'parallel' }],
      },
    });
    expect(refused.message).toContain('`files` is for a change');
    expect(refused.message).toContain('this task already leads one');
    expect(refused.message).not.toContain('`split` starts other changes');
  });
});

describe('the lead’s report', () => {
  test('stores the narrative and keeps the lead leading', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const runId = harness.activeRun(leadId).id;
    report(harness, leadId, '  Dock is in review.  ');
    expect(initiativeOf(harness, initiativeId).report).toMatchObject({
      narrative: 'Dock is in review.',
      runId,
    });
    expect(harness.state.runs[runId]?.outcome).toBe('completed');
    expect(harness.task(leadId).stage).toBe('leading');
  });

  test('refuses an empty or oversized report', () => {
    const { harness, leadId } = ledInitiative();
    const runId = harness.activeRun(leadId).id;
    const send = (narrative: string) =>
      refusal(harness, { type: 'agent.report_initiative', runId, narrative });
    expect(send(' ').message).toBe('narrative is required.');
    expect(send('x'.repeat(INITIATIVE_LIMITS.narrative + 1)).message).toBe(
      `narrative is ${INITIATIVE_LIMITS.narrative + 1} characters; the limit is ${INITIATIVE_LIMITS.narrative}.`
    );
  });

  test('refuses the report outside a lead turn', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    const refused = refusal(harness, {
      type: 'agent.report_initiative',
      runId,
      narrative: 'x',
    });
    expect(refused.code).toBe('wrong_step');
  });

  test('refuses the report once its initiative is cancelled', () => {
    const { harness, leadId } = ledInitiative();
    const runId = harness.activeRun(leadId).id;
    harness.send({ type: 'task.cancel', taskId: leadId });
    const refused = refusal(harness, {
      type: 'agent.report_initiative',
      runId,
      narrative: 'x',
    });
    expect(refused.code).toBe('run_over');
  });

  test('refuses the report of a lead that leads no initiative', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const runId = harness.activeRun(leadId).id;
    harness.state.initiatives[initiativeId] = { ...initiativeOf(harness, initiativeId), leadTaskId: null };
    const refused = refusal(harness, {
      type: 'agent.report_initiative',
      runId,
      narrative: 'x',
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
    const { harness, initiativeId, leadId } = ledInitiative();
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
    report(harness, leadId);
    harness.send({ type: 'task.complete', taskId: leadId });
    harness.send({ type: 'task.cancel', taskId: filedId });
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

  test('waits for an armed retry, whose turn then carries the milestones', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    while (harness.task(leadId).autoRetry?.status !== 'armed') {
      harness.send({
        type: 'run.end',
        runId: harness.activeRun(leadId).id,
        outcome: 'failed',
        summary: 'Broke',
      });
    }
    expect(listActiveRuns(harness.state, leadId)).toEqual([]);
    const memberId = addMember(harness, initiativeId);
    harness.send({ type: 'initiative.wake_lead', initiativeId });
    expect(listActiveRuns(harness.state, leadId)).toEqual([]);
    expect(harness.task(leadId).autoRetry?.status).toBe('armed');
    fireRetry(harness, leadId);
    expect(readInstruction(harness.activeRun(leadId))).toContain(
      `(shinsa://task/${memberId}) joined the initiative`
    );
    expect(initiativeOf(harness, initiativeId).milestones).toEqual([]);
  });

  test('cancelling the lead mid-turn ends its run and dissolves the initiative', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    const member = addMember(harness, initiativeId);
    harness.send({ type: 'task.cancel', taskId: leadId });
    expect(harness.task(leadId).stage).toBe('cancelled');
    expect(harness.state.initiatives[initiativeId]).toBeUndefined();
    expect(harness.task(member).initiativeId).toBeNull();
    expect(
      Object.values(harness.state.runs).filter((run) => run.taskId === leadId && run.endedAt === null)
    ).toHaveLength(0);
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

  test('a member’s message reaches the lead as the agent’s, not the human’s', () => {
    const { harness, initiativeId, leadId } = ledInitiative();
    report(harness, leadId);
    const memberId = addMember(harness, initiativeId);
    harness.send(
      { type: 'task.message', taskId: leadId, text: 'SW-120 should wait for me.' },
      { onBehalf: true, byTask: memberId }
    );
    const prompt = readInstruction(harness.activeRun(leadId));
    expect(prompt).toContain('An agent wrote to you about the initiative “Chat split”.');
    expect(prompt).toContain(
      `The agent of [Rewrite the dock](shinsa://task/${memberId}) wrote, not the human: SW-120 should wait for me.`
    );
    expect(prompt).not.toContain('The human wrote');
    expect(harness.task(leadId).stageReason).toBe('answering a member');
  });

  test('a message sent for you by no task still says an agent wrote it', () => {
    const { harness, leadId } = ledInitiative();
    report(harness, leadId);
    harness.send({ type: 'task.message', taskId: leadId, text: 'Check the dock.' }, { onBehalf: true });
    expect(readInstruction(harness.activeRun(leadId))).toContain(
      'An agent wrote, not the human: Check the dock.'
    );
  });

  test('retrying a lead with guidance passes it on as the human’s', () => {
    const { harness, leadId } = ledInitiative();
    spendRetries(harness, leadId);
    const failLead = () => {
      while (listOpenGates(harness.state, leadId).length === 0) {
        harness.send({
          type: 'run.end',
          runId: harness.activeRun(leadId).id,
          outcome: 'completed',
          summary: null,
        });
      }
    };
    failLead();
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(leadId).id,
      decision: 'reply',
      response: 'Report first.',
    });
    expect(readInstruction(harness.activeRun(leadId))).toContain('The human wrote: Report first.');
  });

  test('a lead turn that ends without its report resumes, and retry restarts it', () => {
    const { harness, leadId } = ledInitiative();
    const first = harness.activeRun(leadId);
    harness.send({ type: 'run.end', runId: first.id, outcome: 'completed', summary: null });
    const second = harness.activeRun(leadId);
    expect(second.id).not.toBe(first.id);
    expect(second.purpose).toBe('lead');
    spendRetries(harness, leadId);
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
    const { harness, initiativeId, leadId } = ledInitiative();
    const repoId = Object.keys(harness.state.repos)[0] ?? '';
    harness.send({ type: 'task.create', request: 'Dock host', repoId, initiativeId });
    const memberId = Object.keys(harness.state.tasks).at(-1) ?? '';
    report(harness, leadId);
    harness.send({ type: 'task.complete', taskId: leadId });
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
    const sheet = Option.getOrNull(resolveInitiativeSheet(harness.state, initiativeId, harness.now));
    expect(sheet?.now.map((task) => task.id)).toEqual([memberId]);
    expect(sheet?.now.map((task) => task.id)).not.toContain(leadId);
  });

  test('a lead stands alone and only Shinsa composes it', () => {
    expect(validatePipeline(['lead', 'answer'])).toContain(
      'A lead plans and leads its initiative, so it has no other step.'
    );
    expect(validatePipeline(['lead'])).toEqual([]);
    expect(validatePipeline(['plan', 'lead'])).toEqual([]);
    expect(needsRepository(['plan', 'lead'])).toBe(false);
    expect(
      validateComposition({ pipeline: ['plan', 'build'], mode: 'build', result: null }, ['lead'])
    ).toContain('Only Shinsa starts a lead, for an initiative.');
  });
});
