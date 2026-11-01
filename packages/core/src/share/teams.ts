import { isTaskSettled } from '../domain/stages.ts';
import type { Gate, Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskProject } from '../state/queries.ts';
import { resolveSharedListing, type SharedListing } from './index.ts';

export const TEAM_SETTLED_LIMIT = 50;

export interface TeamTaskContext {
  owner: string | null;
  machine: string | null;
}

export interface TeamTask extends SharedListing, TeamTaskContext {}

export function listTeamProjectIds(state: ShinsaState, teamId: string) {
  return Object.values(state.projects)
    .filter((project) => (project.teamIds ?? []).includes(teamId))
    .map((project) => project.id);
}

export function isTeamTask(state: ShinsaState, task: Task, teamId: string) {
  if (task.watchHome) return false;
  const projectId = resolveTaskProject(state, task);
  const project = projectId ? state.projects[projectId] : undefined;
  return (project?.teamIds ?? []).includes(teamId);
}

function listGatesByTask(state: ShinsaState) {
  const gates = new Map<string, Gate[]>();
  for (const gate of Object.values(state.gates)) {
    gates.set(gate.taskId, [...(gates.get(gate.taskId) ?? []), gate]);
  }
  return gates;
}

function listTeamTaskSubjects(state: ShinsaState, teamId: string) {
  const tasks = Object.values(state.tasks).filter((task) => isTeamTask(state, task, teamId));
  const open = tasks.filter((task) => !isTaskSettled(task));
  const settled = tasks
    .filter((task) => isTaskSettled(task))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, TEAM_SETTLED_LIMIT);
  return [...open, ...settled];
}

export function listTeamTasks(state: ShinsaState, teamId: string, context: TeamTaskContext): TeamTask[] {
  const gates = listGatesByTask(state);
  return listTeamTaskSubjects(state, teamId).map((task) => ({
    ...resolveSharedListing(state, task, gates.get(task.id) ?? []),
    owner: context.owner,
    machine: context.machine,
  }));
}
