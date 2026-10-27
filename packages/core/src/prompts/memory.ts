import { type MemoryEntry, type Run, type RunRole, TASK_SESSION_ROLES, type Task } from '../domain/index.ts';
import { listKeptMemory } from '../state/memory.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskProject } from '../state/queries.ts';

const MEMORY_HEADING =
  'The human asked agents to remember these rules from earlier work. Follow them unless this task asks otherwise:';

const NEW_MEMORY_HEADING =
  'The human kept new rules for agents since your last turn. Follow them from now on unless this task asks otherwise:';

function isBriefedRole(role: RunRole) {
  return role === 'reviewer' || TASK_SESSION_ROLES.includes(role);
}

function describeRules(heading: string, entries: MemoryEntry[]) {
  if (entries.length === 0) return '';
  return ['', '', heading, ...entries.map((entry) => `- ${entry.text}`)].join('\n');
}

function resolveLastTurnStart(state: ShinsaState, resumeFrom: Run) {
  let latest = resumeFrom.startedAt;
  for (const run of Object.values(state.runs)) {
    if (run.sessionId === resumeFrom.sessionId && run.startedAt > latest) latest = run.startedAt;
  }
  return latest;
}

export function resolveMemoryContext(state: ShinsaState, task: Task) {
  return describeRules(MEMORY_HEADING, listKeptMemory(state, resolveTaskProject(state, task)));
}

export function resolveMemoryTold(state: ShinsaState, task: Task, role: RunRole, resumeFrom: Run | null) {
  if (!isBriefedRole(role)) return '';
  if (!resumeFrom?.sessionId) return resolveMemoryContext(state, task);
  const since = resolveLastTurnStart(state, resumeFrom);
  const fresh = listKeptMemory(state, resolveTaskProject(state, task)).filter(
    (entry) => entry.updatedAt >= since
  );
  return describeRules(NEW_MEMORY_HEADING, fresh);
}
