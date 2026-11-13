import { Option } from 'effect';
import { quoteTitle } from '../chat/text.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  type GateType,
  type Initiative,
  INITIATIVE_LIMITS,
  type InitiativeMilestone,
  type InitiativeTeamMember,
  isInitiativeInTeam,
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
import { isSameTeamMembers } from '../share/teams.ts';
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
  const leadTaskId = startLead(decider, initiative, {
    type: 'task.create',
    request: resolveLeadRequest(initiative),
    repoId: null,
    forkOf: task.id,
    ...(task.projectId ? { projectId: task.projectId } : {}),
  });
  decider.emit({
    type: 'task.reshaped',
    taskId: leadTaskId,
    pipeline: ['lead'],
    by: 'shinsa',
    reason: 'its tasks exist already, so it leads them without a plan',
  });
  return initiative.id;
}

function resolvePlanPhases(initiative: Initiative, titles: readonly string[], newId: () => string) {
  const phases = [...initiative.phases];
  for (const title of titles) {
    const name = resolveInitiativeText(title).slice(0, INITIATIVE_LIMITS.phaseName);
    if (phases.length >= INITIATIVE_LIMITS.phases) break;
    if (phases.some((phase) => phase.name.toLowerCase() === name.toLowerCase())) continue;
    phases.push({ id: newId(), name });
  }
  return phases;
}

function findPlannedPhase(initiative: Initiative, lead: Task, number: number | undefined) {
  const title = lead.plan?.document?.phases[(number ?? 0) - 1]?.title;
  if (!title) return null;
  const name = resolveInitiativeText(title).slice(0, INITIATIVE_LIMITS.phaseName).toLowerCase();
  return initiative.phases.find((phase) => phase.name.toLowerCase() === name) ?? null;
}

function placePlannedTasks(decider: Decider, lead: Task, initiative: Initiative) {
  const parts = lead.plan?.document?.split ?? [];
  const version = lead.plan?.version ?? 0;
  const split = (lead.splits ?? []).filter((entry) => entry.planVersion === version).at(-1);
  for (const [index, taskId] of (split?.taskIds ?? []).entries()) {
    const phase = findPlannedPhase(initiative, lead, parts[index]?.phase);
    const member = decider.state.tasks[taskId];
    if (!phase || !member || member.initiativePhaseId === phase.id) continue;
    changeMembership(decider, member, { initiativeId: initiative.id, phaseId: phase.id });
  }
}

export function startLeadPlan(decider: Decider, taskId: string) {
  const lead = decider.task(taskId);
  const initiative = findLeadInitiative(decider, taskId);
  const titles = (lead.plan?.document?.phases ?? []).map((phase) => phase.title);
  const phases = resolvePlanPhases(initiative, titles, decider.context.newId);
  if (phases.length > initiative.phases.length) {
    decider.emit({
      type: 'initiative.written',
      initiative: { ...initiative, phases, updatedAt: decider.context.now },
    });
  }
  placePlannedTasks(decider, lead, findInitiative(decider, initiative.id));
  startLeadTurn(decider, taskId, null);
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
    const initiative = Option.getOrNull(selectLeadInitiative(listInitiatives(decider.state), event.taskId));
    if (initiative) dissolveInitiative(decider, initiative);
  }
}

function isIdle(state: ShinsaState, task: Task) {
  return listActiveRuns(state, task.id).length === 0 && listOpenGates(state, task.id).length === 0;
}

function findLeadInitiative(decider: Decider, taskId: string) {
  const initiative = Option.getOrNull(selectLeadInitiative(listInitiatives(decider.state), taskId));
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
  const sheet = Option.getOrNull(resolveInitiativeSheet(decider.state, initiative.id, now));
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
  const lead = Option.getOrNull(selectInitiativeLead(decider.state, initiative));
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
  const validation = validateInitiativeReport({ narrative: command.narrative });
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
  if (!Option.getOrNull(selectInitiativeLead(decider.state, initiative))) return null;
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

interface TeamMilestone {
  kind: InitiativeMilestone['kind'];
  text: string;
}

function resolveTeamMilestone(
  before: InitiativeTeamMember | undefined,
  after: InitiativeTeamMember
): TeamMilestone | null {
  if (!before) return { kind: 'joined', text: '' };
  if (before.stage !== after.stage) {
    const kind = resolveStagedKind(after.stage);
    if (kind) return { kind, text: '' };
    if (before.stage === 'planning' && after.stage === 'building') return { kind: 'plan_approved', text: '' };
  }
  if (!before.gate && after.gate) return { kind: 'gate_opened', text: after.gate };
  return null;
}

function resolveMemberKey(member: Pick<InitiativeTeamMember, 'instanceId' | 'taskId'>) {
  return `${member.instanceId}:${member.taskId}`;
}

function listTeamMilestones(
  decider: Decider,
  previous: readonly InitiativeTeamMember[],
  members: readonly InitiativeTeamMember[]
): InitiativeMilestone[] {
  const known = new Map(previous.map((member) => [resolveMemberKey(member), member]));
  return members.flatMap((member) => {
    const found = resolveTeamMilestone(known.get(resolveMemberKey(member)), member);
    if (!found) return [];
    return [
      {
        taskId: member.taskId,
        kind: found.kind,
        text: clip(found.text),
        at: decider.context.now,
        teammate: {
          instanceId: member.instanceId,
          handle: member.handle,
          title: member.title,
          owner: member.owner,
        },
      },
    ];
  });
}

export function recordTeamMembers(decider: Decider, command: CommandOf<'initiative.record_team_members'>) {
  const initiative = decider.state.initiatives[command.initiativeId];
  if (!initiative || !isInitiativeInTeam(initiative, command.teamId)) return;
  if (Option.isNone(selectInitiativeLead(decider.state, initiative))) return;
  const members = command.members
    .filter((member) => member.teamId === command.teamId)
    .slice(0, INITIATIVE_LIMITS.teamMembers);
  const previous = (initiative.teamMembers ?? []).filter((member) => member.teamId === command.teamId);
  if (isSameTeamMembers(previous, members)) return;
  decider.emit({
    type: 'initiative.team_members_recorded',
    initiativeId: initiative.id,
    teamId: command.teamId,
    members,
  });
  const milestones = listTeamMilestones(decider, previous, members);
  if (milestones.length === 0) return;
  decider.emit({ type: 'initiative.milestones_queued', initiativeId: initiative.id, milestones });
  requestWake(decider, findInitiative(decider, initiative.id));
}
