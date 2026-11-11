import {
  type Initiative,
  type InitiativePhase,
  type InitiativeReport,
  isInitiativeInTeam,
} from '../domain/initiatives.ts';
import { isTaskSettled } from '../domain/stages.ts';
import type { ActivityPerson, Gate, Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskProject } from '../state/queries.ts';
import { resolveSharedListing, type SharedListing, type SharedPerson } from './index.ts';
import { SHARE_PRESET_SCOPES } from './presets.ts';

export const TEAM_SETTLED_LIMIT = 50;

export const TEAM_SHARE_SCOPES = SHARE_PRESET_SCOPES.standard;

export interface TeamTaskContext {
  owner: string | null;
  ownerProfile: SharedPerson | null;
  machine: string | null;
}

export interface TeamTask extends SharedListing, Omit<TeamTaskContext, 'ownerProfile'> {
  ownerProfile?: SharedPerson | null;
  heldBy?: ActivityPerson | null;
}

function resolveHolder(task: Task, teamId: string): ActivityPerson | null {
  const guest = task.handoff?.teamId === teamId ? task.handoff.guest : null;
  return guest ? { login: guest.login, name: guest.name, avatarUrl: guest.avatarUrl } : null;
}

export function listTeamProjectIds(state: ShinsaState, teamId: string) {
  return Object.values(state.projects)
    .filter((project) => (project.teamIds ?? []).includes(teamId))
    .map((project) => project.id);
}

export interface TeamInitiative {
  id: string;
  name: string;
  description: string;
  phases: InitiativePhase[];
  leadTaskId: string;
  report: InitiativeReport | null;
  finished: boolean;
  updatedAt: number;
}

function isSharedLead(state: ShinsaState, task: Task, teamId: string) {
  const initiative = task.initiativeId ? state.initiatives[task.initiativeId] : undefined;
  return initiative?.leadTaskId === task.id && isInitiativeInTeam(initiative, teamId);
}

export function isTeamTask(state: ShinsaState, task: Task, teamId: string) {
  if (task.watchHome) return false;
  if (isSharedLead(state, task, teamId)) return true;
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
    ...resolveSharedListing(state, task, gates.get(task.id) ?? [], TEAM_SHARE_SCOPES),
    owner: context.owner,
    ownerProfile: context.ownerProfile,
    machine: context.machine,
    heldBy: resolveHolder(task, teamId),
  }));
}

function resolveTeamInitiative(initiative: Initiative, lead: Task): TeamInitiative {
  return {
    id: initiative.id,
    name: initiative.name,
    description: initiative.description,
    phases: initiative.phases.map((phase) => ({ ...phase })),
    leadTaskId: lead.id,
    report: initiative.report ?? null,
    finished: isTaskSettled(lead),
    updatedAt: initiative.updatedAt,
  };
}

export function listTeamInitiatives(state: ShinsaState, teamId: string): TeamInitiative[] {
  return Object.values(state.initiatives).flatMap((initiative) => {
    const lead = initiative.leadTaskId ? state.tasks[initiative.leadTaskId] : undefined;
    if (!lead || !isInitiativeInTeam(initiative, teamId)) return [];
    return [resolveTeamInitiative(initiative, lead)];
  });
}
