import { listMemory, MEMORY_LIMITS, type MemoryEntry, type Project, type ShinsaState } from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';

export const EVERY_PROJECT = 'every';

export const EVERY_PROJECT_LABEL = 'Every project';

export interface MemoryScopeGroup {
  project: Project | null;
  entries: MemoryEntry[];
}

export interface MemoryGroups {
  proposals: MemoryEntry[];
  scopes: MemoryScopeGroup[];
}

export function listMemoryGroups(state: ShinsaState): MemoryGroups {
  const entries = listMemory(state);
  const kept = entries.filter((entry) => entry.status === 'kept');
  const projects = Object.values(state.projects).sort((left, right) => left.name.localeCompare(right.name));
  const scopes = [
    { project: null, entries: kept.filter((entry) => entry.projectId === null) },
    ...projects.map((project) => ({
      project,
      entries: kept.filter((entry) => entry.projectId === project.id),
    })),
  ];
  return {
    proposals: entries.filter((entry) => entry.status === 'proposed'),
    scopes: scopes.filter((scope) => scope.project === null || scope.entries.length > 0),
  };
}

export function listScopeItems(state: ShinsaState) {
  return [
    { value: EVERY_PROJECT, label: EVERY_PROJECT_LABEL },
    ...Object.values(state.projects)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((project) => ({ value: project.id, label: project.name, dot: project.color })),
  ];
}

export function resolveScopeValue(projectId: string | null) {
  return projectId ?? EVERY_PROJECT;
}

export function parseScopeValue(value: string) {
  return value === EVERY_PROJECT ? null : value;
}

export function describeScopeName(state: ShinsaState, projectId: string | null) {
  if (projectId === null) return EVERY_PROJECT_LABEL;
  return state.projects[projectId]?.name ?? 'A removed project';
}

export function describeProposal(state: ShinsaState, entry: MemoryEntry) {
  const scope = describeScopeName(state, entry.projectId);
  return entry.why ? `${scope} · ${entry.why}` : scope;
}

export function describeRuleSubmit(memoryId: string | null, proposed: boolean) {
  if (memoryId === null) return 'Add rule';
  return proposed ? 'Keep' : 'Save';
}

export function describeRuleCount(count: number) {
  return `${count} of ${MEMORY_LIMITS.keptPerScope}`;
}

export function describeRuleLength(text: string) {
  return `${text.trim().length} / ${MEMORY_LIMITS.text}`;
}

export function validateRule(text: string) {
  const length = text.trim().length;
  if (length === 0) return 'Write the rule for agents to follow.';
  if (length > MEMORY_LIMITS.text) return `Keep it to ${MEMORY_LIMITS.text} characters. It has ${length}.`;
  return null;
}

export interface MemoryActions {
  write: (memoryId: string | null, projectId: string | null, text: string) => Promise<boolean>;
  keep: (entry: MemoryEntry) => Promise<boolean>;
  remove: (entry: MemoryEntry) => Promise<boolean>;
}

export const MEMORY_ACTIONS: MemoryActions = {
  write: (memoryId, projectId, text) =>
    sendCommandWithToast(
      { type: 'memory.write', memoryId, projectId, text },
      memoryId ? 'Rule saved.' : 'Agents follow it from their next turn.'
    ),
  keep: (entry) =>
    sendCommandWithToast(
      { type: 'memory.accept', memoryId: entry.id },
      'Kept. Agents follow it from their next turn.'
    ),
  remove: (entry) =>
    sendCommandWithToast(
      { type: 'memory.remove', memoryId: entry.id },
      entry.status === 'proposed' ? 'Dismissed.' : 'Agents no longer follow it.'
    ),
};
