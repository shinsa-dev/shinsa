import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  MEMORY_LIMITS,
  type MemoryEntry,
  type MemoryScope,
  resolveMemoryText,
} from '../domain/index.ts';
import { listMemory } from '../state/memory.ts';
import { resolveTaskProject } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { findCurrentRun } from './runs.ts';

function assertHumanWrites(decider: Decider) {
  if (!decider.context.onBehalf) return;
  throw new DomainError(
    'human_only',
    'Only the human decides what agents remember. Propose a rule with `remember` instead.'
  );
}

function findMemory(decider: Decider, memoryId: string) {
  const entry = decider.state.memories[memoryId];
  if (!entry) throw new DomainError('memory_not_found', `No memory ${memoryId}`);
  return entry;
}

function assertText(text: string) {
  if (text.length === 0) throw new DomainError('memory_invalid', 'Write the rule for agents to remember.');
  if (text.length > MEMORY_LIMITS.text) {
    throw new DomainError(
      'memory_invalid',
      `A rule can be at most ${MEMORY_LIMITS.text} characters. Keep it to one short sentence.`
    );
  }
}

function countKept(decider: Decider, projectId: string | null, except: string | null) {
  return listMemory(decider.state).filter(
    (entry) => entry.status === 'kept' && entry.projectId === projectId && entry.id !== except
  ).length;
}

function assertRoomToKeep(decider: Decider, projectId: string | null, except: string | null) {
  if (countKept(decider, projectId, except) < MEMORY_LIMITS.keptPerScope) return;
  const where = projectId ? 'this project' : 'every project';
  throw new DomainError(
    'memory_full',
    `Agents already remember ${MEMORY_LIMITS.keptPerScope} rules for ${where}. Remove one first.`
  );
}

function assertProject(decider: Decider, projectId: string | null) {
  if (projectId === null || decider.state.projects[projectId]) return;
  throw new DomainError('project_not_found', `No project ${projectId}`);
}

function keep(decider: Decider, entry: MemoryEntry, patch: Pick<MemoryEntry, 'projectId' | 'text'>) {
  const next = { ...entry, ...patch, status: 'kept' as const };
  if (next.status === entry.status && next.projectId === entry.projectId && next.text === entry.text) return;
  assertRoomToKeep(decider, next.projectId, entry.id);
  decider.emit({ type: 'memory.written', entry: { ...next, updatedAt: decider.context.now } });
}

export function writeMemory(decider: Decider, command: CommandOf<'memory.write'>) {
  assertHumanWrites(decider);
  const text = resolveMemoryText(command.text);
  assertText(text);
  assertProject(decider, command.projectId);
  const patch = { projectId: command.projectId, text };
  if (command.memoryId) {
    keep(decider, findMemory(decider, command.memoryId), patch);
    return;
  }
  assertRoomToKeep(decider, command.projectId, null);
  decider.emit({
    type: 'memory.written',
    entry: {
      id: decider.context.newId(),
      ...patch,
      why: null,
      status: 'kept',
      taskId: null,
      runId: null,
      createdAt: decider.context.now,
      updatedAt: decider.context.now,
    },
  });
}

export function acceptMemory(decider: Decider, command: CommandOf<'memory.accept'>) {
  assertHumanWrites(decider);
  const entry = findMemory(decider, command.memoryId);
  keep(decider, entry, { projectId: entry.projectId, text: entry.text });
}

export function removeMemory(decider: Decider, command: CommandOf<'memory.remove'>) {
  assertHumanWrites(decider);
  findMemory(decider, command.memoryId);
  decider.emit({ type: 'memory.removed', memoryId: command.memoryId });
}

export function removeProjectMemory(decider: Decider, projectId: string) {
  for (const entry of listMemory(decider.state)) {
    if (entry.projectId === projectId) decider.emit({ type: 'memory.removed', memoryId: entry.id });
  }
}

function resolveScopeProject(scope: MemoryScope, projectId: string | null) {
  if (scope === 'global') return null;
  if (projectId) return projectId;
  throw new DomainError(
    'memory_no_project',
    'This task belongs to no project. Propose the rule for every project with `scope: "global"`, or leave it.'
  );
}

function isKnown(decider: Decider, projectId: string | null, text: string) {
  const key = text.toLowerCase();
  return listMemory(decider.state).some(
    (entry) => entry.projectId === projectId && entry.text.toLowerCase() === key
  );
}

function countProposals(decider: Decider) {
  return listMemory(decider.state).filter((entry) => entry.status === 'proposed').length;
}

export function rememberRule(decider: Decider, command: CommandOf<'agent.remember'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'remember');
  const projectId = resolveScopeProject(command.scope, resolveTaskProject(decider.state, task));
  const text = resolveMemoryText(command.text);
  assertText(text);
  if (isKnown(decider, projectId, text)) return;
  if (countProposals(decider) >= MEMORY_LIMITS.proposals) {
    throw new DomainError(
      'memory_proposals_full',
      `The human already has ${MEMORY_LIMITS.proposals} rules to look at. Leave this one and carry on with your step.`
    );
  }
  decider.emit({
    type: 'memory.proposed',
    entry: {
      id: decider.context.newId(),
      projectId,
      text,
      why: command.why.trim(),
      status: 'proposed',
      taskId: task.id,
      runId: run.id,
      createdAt: decider.context.now,
      updatedAt: decider.context.now,
    },
  });
}
