import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  INITIATIVE_LIMITS,
  type Initiative,
  type InitiativePhase,
  NO_FOCUS,
  resolveInitiativeText,
  selectInitiativePhase,
  type Task,
} from '../domain/index.ts';
import { listInitiativeMembers, listInitiatives } from '../state/initiatives.ts';
import type { Decider } from './decider.ts';
import { isSameValue } from './equality.ts';

interface Membership {
  initiativeId: string | null;
  phaseId: string | null;
}

export function findInitiative(decider: Decider, initiativeId: string) {
  const initiative = decider.state.initiatives[initiativeId];
  if (!initiative) {
    throw new DomainError({ code: 'initiative_not_found', message: `No initiative ${initiativeId}.` });
  }
  return initiative;
}

function refuse(message: string): never {
  throw new DomainError({ code: 'initiative_invalid', message });
}

function resolveName(name: string) {
  const text = resolveInitiativeText(name);
  if (text.length === 0) refuse('Name the initiative.');
  if (text.length > INITIATIVE_LIMITS.name) {
    refuse(`An initiative's name can be at most ${INITIATIVE_LIMITS.name} characters.`);
  }
  return text;
}

function resolveDescription(description: string) {
  const text = description.trim();
  if (text.length > INITIATIVE_LIMITS.description) {
    refuse(`A description can be at most ${INITIATIVE_LIMITS.description} characters.`);
  }
  return text;
}

function resolvePhaseName(name: string, seen: Set<string>) {
  const text = resolveInitiativeText(name);
  if (text.length === 0) refuse('Name every phase.');
  if (text.length > INITIATIVE_LIMITS.phaseName) {
    refuse(`A phase's name can be at most ${INITIATIVE_LIMITS.phaseName} characters.`);
  }
  const key = text.toLowerCase();
  if (seen.has(key)) refuse(`Two phases are named ${text}. Give each phase its own name.`);
  seen.add(key);
  return text;
}

function resolvePhases(
  decider: Decider,
  existing: Initiative | null,
  phases: CommandOf<'initiative.write'>['phases']
): InitiativePhase[] {
  if (phases === undefined) return existing?.phases.map((phase) => ({ ...phase })) ?? [];
  if (phases.length > INITIATIVE_LIMITS.phases) {
    refuse(`An initiative can have at most ${INITIATIVE_LIMITS.phases} phases.`);
  }
  const seen = new Set<string>();
  return phases.map((phase) => {
    const name = resolvePhaseName(phase.name, seen);
    if (phase.id === null) return { id: decider.context.newId(), name };
    if (!existing || !selectInitiativePhase(existing, phase.id))
      refuse(`No phase ${phase.id} in this initiative.`);
    return { id: phase.id, name };
  });
}

function changeMembership(decider: Decider, task: Task, next: Membership) {
  const current: Membership = {
    initiativeId: task.initiativeId ?? null,
    phaseId: task.initiativeId ? (task.initiativePhaseId ?? null) : null,
  };
  if (isSameValue(current, next)) return;
  decider.emit({ type: 'task.initiative_changed', taskId: task.id, ...next });
}

function dropRemovedPhases(decider: Decider, initiative: Initiative) {
  for (const task of listInitiativeMembers(decider.state, initiative.id)) {
    if (selectInitiativePhase(initiative, task.initiativePhaseId)) continue;
    changeMembership(decider, task, { initiativeId: initiative.id, phaseId: null });
  }
}

function assertRoomForInitiative(decider: Decider) {
  if (listInitiatives(decider.state).length < INITIATIVE_LIMITS.initiatives) return;
  throw new DomainError({
    code: 'initiative_limit',
    message: `${INITIATIVE_LIMITS.initiatives} initiatives already. Remove one you no longer need first.`,
  });
}

function createInitiative(decider: Decider, name: string, description: string, phases: InitiativePhase[]) {
  assertRoomForInitiative(decider);
  const now = decider.context.now;
  const initiative: Initiative = {
    id: decider.context.newId(),
    name,
    description,
    phases,
    leadTaskId: null,
    createdAt: now,
    updatedAt: now,
  };
  decider.emit({ type: 'initiative.written', initiative });
  return initiative;
}

export function writeInitiative(decider: Decider, command: CommandOf<'initiative.write'>) {
  const existing = command.initiativeId ? findInitiative(decider, command.initiativeId) : null;
  const name = resolveName(command.name);
  const description = resolveDescription(command.description ?? existing?.description ?? '');
  const phases = resolvePhases(decider, existing, command.phases);
  if (!existing) return createInitiative(decider, name, description, phases).id;
  const next = { ...existing, name, description, phases };
  if (isSameValue(next, existing)) return existing.id;
  const initiative = { ...next, updatedAt: decider.context.now };
  decider.emit({ type: 'initiative.written', initiative });
  dropRemovedPhases(decider, initiative);
  return existing.id;
}

export function removeInitiative(decider: Decider, command: CommandOf<'initiative.remove'>) {
  const initiative = findInitiative(decider, command.initiativeId);
  for (const task of listInitiativeMembers(decider.state, initiative.id)) {
    changeMembership(decider, task, { initiativeId: null, phaseId: null });
  }
  if (decider.state.focus.initiativeId === initiative.id) {
    decider.emit({ type: 'focus.changed', focus: NO_FOCUS });
    decider.run({ kind: 'briefing.request', projectId: null });
  }
  decider.emit({ type: 'initiative.removed', initiativeId: initiative.id });
}

export function resolveMembership(
  decider: Decider,
  initiativeId: string,
  phaseId: string | null | undefined
) {
  const initiative = findInitiative(decider, initiativeId);
  if (phaseId && !selectInitiativePhase(initiative, phaseId)) {
    throw new DomainError({
      code: 'initiative_phase_not_found',
      message: `No phase ${phaseId} in the initiative ${initiative.name}.`,
    });
  }
  return { initiativeId: initiative.id, phaseId: phaseId ?? null };
}

export function joinInitiative(decider: Decider, command: CommandOf<'task.join_initiative'>) {
  const task = decider.task(command.taskId);
  if (command.initiativeId === null) {
    changeMembership(decider, task, { initiativeId: null, phaseId: null });
    return;
  }
  changeMembership(decider, task, resolveMembership(decider, command.initiativeId, command.phaseId));
}

function isChildOf(task: Task, ids: ReadonlySet<string>) {
  const parents = [task.createdBy?.taskId, task.parentTaskId, task.forkOf];
  return parents.some((id) => id !== undefined && id !== null && ids.has(id));
}

export function listTaskDescendants(tasks: readonly Task[], rootId: string): Task[] {
  const found = new Set([rootId]);
  const descendants: Task[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const task of tasks) {
      if (found.has(task.id) || !isChildOf(task, found)) continue;
      found.add(task.id);
      descendants.push(task);
      added = true;
    }
  }
  return descendants;
}

export function adoptTask(decider: Decider, command: CommandOf<'initiative.adopt_task'>) {
  const task = decider.task(command.taskId);
  const current = task.initiativeId ? decider.state.initiatives[task.initiativeId] : undefined;
  if (current) {
    throw new DomainError({
      code: 'initiative_exists',
      message: `This task is already in the initiative ${current.name}. Take it out first.`,
    });
  }
  const name = resolveInitiativeText(task.title).slice(0, INITIATIVE_LIMITS.name) || 'Untitled initiative';
  const initiative = createInitiative(decider, name, '', []);
  const members = [task, ...listTaskDescendants(Object.values(decider.state.tasks), task.id)];
  for (const member of members) {
    if (member.initiativeId && decider.state.initiatives[member.initiativeId]) continue;
    changeMembership(decider, member, { initiativeId: initiative.id, phaseId: null });
  }
  return initiative.id;
}

function resolveInheritedMembership(
  decider: Decider,
  command: CommandOf<'task.create'>,
  sourceId: string | undefined
): Membership | null {
  if (command.initiativeId !== undefined) {
    return resolveMembership(decider, command.initiativeId, command.initiativePhaseId);
  }
  const source = sourceId ? decider.state.tasks[sourceId] : undefined;
  const initiative = source?.initiativeId ? decider.state.initiatives[source.initiativeId] : undefined;
  if (!source || !initiative) return null;
  const phase = selectInitiativePhase(initiative, source.initiativePhaseId);
  return { initiativeId: initiative.id, phaseId: phase?.id ?? null };
}

interface CreatedLineage {
  parentTaskId?: string;
  createdBy?: { taskId: string };
}

export function resolveCreatedMembership(
  decider: Decider,
  command: CommandOf<'task.create'>,
  lineage: CreatedLineage
): { initiativeId?: string; initiativePhaseId?: string } {
  const sourceId = lineage.parentTaskId ?? lineage.createdBy?.taskId ?? command.forkOf;
  const membership = resolveInheritedMembership(decider, command, sourceId);
  if (!membership?.initiativeId) return {};
  return {
    initiativeId: membership.initiativeId,
    ...(membership.phaseId ? { initiativePhaseId: membership.phaseId } : {}),
  };
}
