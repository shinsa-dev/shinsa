import { quoteTitle } from '../chat/text.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  type GateType,
  type Initiative,
  INITIATIVE_LIMITS,
  type InitiativeMilestone,
  resolveGateDefinition,
  resolveInitiativeText,
  selectLeadInitiative,
  type Task,
} from '../domain/index.ts';
import type { ShinsaEventInput } from '../events/index.ts';
import {
  describeInitiativeDigest,
  describeMilestones,
  resolveInitiativeSheet,
  validateInitiativeReport,
} from '../initiatives/index.ts';
import { type LeadNote, resolveAgentPrompt, resolveLeadPrompt } from '../prompts/index.ts';
import { listInitiatives, selectInitiativeLead } from '../state/initiatives.ts';
import type { ShinsaState } from '../state/project.ts';
import { listActiveRuns, listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import {
  adoptDescendants,
  assertNotInInitiative,
  changeMembership,
  createInitiative,
  dissolveInitiative,
  findInitiative,
} from './initiatives.ts';
import { findCurrentRun } from './runs.ts';
import { createTask } from './tasks.ts';

const MILESTONE_GATES: ReadonlySet<GateType> = new Set<GateType>([
  'plan',
  'review',
  'merge',
  'question',
  'proposal',
  'operation',
  'failure',
  'result',
]);

const MILESTONE_TEXT_LIMIT = 280;

function resolveLeadRequest(initiative: Initiative) {
  const description = initiative.description ? `\n\n${initiative.description}` : '';
  return `Lead the initiative ${quoteTitle(initiative.name)}: keep its tasks moving, file and order the next pieces, and report where it stands.${description}`;
}

function startLead(decider: Decider, initiative: Initiative, command: CommandOf<'task.create'>) {
  const leadTaskId = createTask(decider, command, { shape: 'lead' });
  decider.emit({
    type: 'initiative.written',
    initiative: { ...initiative, leadTaskId, updatedAt: decider.context.now },
  });
  changeMembership(decider, decider.task(leadTaskId), { initiativeId: initiative.id, phaseId: null });
  return leadTaskId;
}

function splitRequest(request: string) {
  const [first = '', ...rest] = request.trim().split('\n');
  const name = resolveInitiativeText(first).slice(0, INITIATIVE_LIMITS.name);
  return { name, description: rest.join('\n').trim().slice(0, INITIATIVE_LIMITS.description) };
}

export function createInitiativeTask(decider: Decider, command: CommandOf<'task.create'>) {
  const { name, description } = splitRequest(command.request);
  const initiative = createInitiative(decider, name, description);
  const {
    initiative: _initiative,
    initiativeId: _id,
    initiativePhaseId: _phase,
    stacksOn: _stack,
    ...rest
  } = command;
  return startLead(decider, initiative, rest);
}

export function adoptTask(decider: Decider, command: CommandOf<'initiative.adopt_task'>) {
  const task = decider.task(command.taskId);
  assertNotInInitiative(decider, task);
  const name = resolveInitiativeText(task.title).slice(0, INITIATIVE_LIMITS.name) || 'Untitled initiative';
  const initiative = createInitiative(decider, name, '');
  adoptDescendants(decider, initiative, task);
  startLead(decider, initiative, {
    type: 'task.create',
    request: resolveLeadRequest(initiative),
    repoId: null,
    forkOf: task.id,
    ...(task.projectId ? { projectId: task.projectId } : {}),
  });
  return initiative.id;
}

export function startPlanInitiative(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!task.plan?.document?.initiative || task.initiativeId) return;
  adoptTask(decider, { type: 'initiative.adopt_task', taskId });
}

export function syncCancelledLeads(decider: Decider, before: ShinsaState) {
  for (const event of [...decider.events]) {
    if (event.type !== 'task.staged' || event.stage !== 'cancelled') continue;
    if (before.tasks[event.taskId]?.stage === 'cancelled') continue;
    const initiative = selectLeadInitiative(listInitiatives(decider.state), event.taskId);
    if (initiative) dissolveInitiative(decider, initiative);
  }
}

function isIdle(state: ShinsaState, task: Task) {
  return listActiveRuns(state, task.id).length === 0 && listOpenGates(state, task.id).length === 0;
}

function findLeadInitiative(decider: Decider, taskId: string) {
  const initiative = selectLeadInitiative(listInitiatives(decider.state), taskId);
  if (!initiative) {
    throw new DomainError({
      code: 'initiative_not_found',
      message: 'This task leads no initiative any more. End your turn.',
    });
  }
  return initiative;
}

function resolveLeadReason(note: LeadNote | null) {
  if (!note) return 'leading the initiative';
  return note.byAgent ? 'answering a member' : 'answering your message';
}

export function startLeadTurn(decider: Decider, taskId: string, note: LeadNote | null) {
  const initiative = findLeadInitiative(decider, taskId);
  decider.stage(taskId, 'leading', resolveLeadReason(note));
  const now = decider.context.now;
  const sheet = resolveInitiativeSheet(decider.state, initiative.id, now);
  const milestones = initiative.milestones ?? [];
  const prompt = resolveLeadPrompt({
    initiative,
    digest: sheet ? describeInitiativeDigest(sheet) : '',
    milestones: describeMilestones(decider.state, milestones),
    note,
    first: initiative.report === undefined || initiative.report === null,
  });
  const run = decider.startRun(decider.task(taskId), 'agent', resolveAgentPrompt(prompt), {
    purpose: 'lead',
    resumeFrom: decider.taskSession(taskId, 'agent'),
  });
  if (milestones.length > 0) {
    decider.emit({ type: 'initiative.lead_woken', initiativeId: initiative.id, runId: run.id });
  }
}

export function wakeLead(decider: Decider, command: CommandOf<'initiative.wake_lead'>) {
  const initiative = decider.state.initiatives[command.initiativeId];
  if (!initiative || (initiative.milestones ?? []).length === 0) return;
  const lead = selectInitiativeLead(decider.state, initiative);
  if (!lead || lead.stage !== 'leading' || !isIdle(decider.state, lead)) return;
  startLeadTurn(decider, lead.id, null);
}

function requestWake(decider: Decider, initiative: Initiative) {
  if ((initiative.milestones ?? []).length === 0) return;
  decider.run({ kind: 'initiative.wake', initiativeId: initiative.id });
}

export function reportInitiative(decider: Decider, command: CommandOf<'agent.report_initiative'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'report_initiative');
  const initiative = findLeadInitiative(decider, task.id);
  const validation = validateInitiativeReport({
    narrative: command.narrative,
    questions: command.questions,
  });
  if (!validation.ok) {
    throw new DomainError({ code: 'report_invalid', message: validation.errors.join(' ') });
  }
  const report = validation.value;
  decider.emit({
    type: 'initiative.reported',
    initiativeId: initiative.id,
    report: { ...report, runId: run.id, at: decider.context.now },
  });
  decider.endRun(run, 'completed', 'Reported on the initiative');
  decider.progressed(task.id);
  requestWake(decider, findInitiative(decider, initiative.id));
}

interface FoundMilestone {
  initiativeId: string;
  milestone: InitiativeMilestone;
}

function clip(text: string) {
  const line = text.trim().split('\n', 1)[0] ?? '';
  return line.length > MILESTONE_TEXT_LIMIT ? `${line.slice(0, MILESTONE_TEXT_LIMIT - 1)}…` : line;
}

function resolveMemberMilestone(
  decider: Decider,
  taskId: string,
  kind: InitiativeMilestone['kind'],
  text: string
): FoundMilestone | null {
  const task = decider.state.tasks[taskId];
  const initiative = task?.initiativeId ? decider.state.initiatives[task.initiativeId] : undefined;
  if (!task || !initiative || initiative.leadTaskId === task.id) return null;
  if (!selectInitiativeLead(decider.state, initiative)) return null;
  if (kind === 'joined' && task.createdBy?.taskId === initiative.leadTaskId) return null;
  return {
    initiativeId: initiative.id,
    milestone: { taskId, kind, text: clip(text), at: decider.context.now },
  };
}

function resolveStagedKind(stage: Task['stage']): InitiativeMilestone['kind'] | null {
  if (stage === 'merged' || stage === 'done' || stage === 'cancelled') return stage;
  return null;
}

function findMilestone(decider: Decider, before: ShinsaState, event: ShinsaEventInput) {
  switch (event.type) {
    case 'gate.opened':
      if (!MILESTONE_GATES.has(event.gate.type)) return null;
      return resolveMemberMilestone(
        decider,
        event.gate.taskId,
        'gate_opened',
        resolveGateDefinition(event.gate).title
      );
    case 'plan.approved': {
      const goal = decider.state.tasks[event.taskId]?.plan?.document?.goal ?? '';
      return resolveMemberMilestone(decider, event.taskId, 'plan_approved', goal);
    }
    case 'task.staged': {
      if (event.stage === 'building' && before.tasks[event.taskId]?.stage === 'planning') {
        const goal = decider.state.tasks[event.taskId]?.plan?.document?.goal ?? '';
        return resolveMemberMilestone(decider, event.taskId, 'plan_approved', goal);
      }
      const kind = resolveStagedKind(event.stage);
      if (!kind || before.tasks[event.taskId]?.stage === event.stage) return null;
      return resolveMemberMilestone(decider, event.taskId, kind, event.reason);
    }
    case 'task.created':
      if (!event.initiativeId) return null;
      return resolveMemberMilestone(decider, event.taskId, 'joined', event.request);
    case 'task.initiative_changed':
      if (!event.initiativeId || before.tasks[event.taskId]?.initiativeId === event.initiativeId) return null;
      return resolveMemberMilestone(decider, event.taskId, 'joined', '');
    default:
      return null;
  }
}

export function syncInitiativeMilestones(decider: Decider, before: ShinsaState) {
  const found = new Map<string, InitiativeMilestone[]>();
  for (const event of [...decider.events]) {
    const entry = findMilestone(decider, before, event);
    if (!entry) continue;
    found.set(entry.initiativeId, [...(found.get(entry.initiativeId) ?? []), entry.milestone]);
  }
  for (const [initiativeId, milestones] of found) {
    decider.emit({ type: 'initiative.milestones_queued', initiativeId, milestones });
    requestWake(decider, findInitiative(decider, initiativeId));
  }
}
