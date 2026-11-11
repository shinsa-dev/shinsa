import {
  type Initiative,
  isInitiativeInTeam,
  isLeadTask,
  type Task,
  type TeamFeedInitiative,
  type TeamFeedSnapshot,
  type TeamFeedTask,
  type TeamViewTarget,
} from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { FocusTeam } from '@/lib/focus.ts';
import { resolveTeamTaskPath } from '@/lib/teams/feeds.ts';

export const SHARE_WITH_TEAM = 'Share with a team';

export const TEAMMATE_INITIATIVE = 'A teammate’s initiative';

export const TEAMMATE_INITIATIVES = 'Teammates’ initiatives';

export const TEAMMATE_INITIATIVE_AWAY = 'The teammate’s machine is not reachable now';

export interface TeamShareChoice {
  team: FocusTeam;
  shared: boolean;
}

function isSameInitiative(left: TeamFeedInitiative, right: TeamFeedInitiative) {
  return left.instanceId === right.instanceId && left.id === right.id;
}

export function listTeamInitiativeChoices(
  feed: TeamFeedSnapshot,
  teams: readonly FocusTeam[],
  task: Task
): TeamFeedInitiative[] {
  if (isLeadTask(task)) return [];
  const teamIds = new Set(teams.map((team) => team.id));
  const current = task.teamInitiative;
  const choices: TeamFeedInitiative[] = [];
  for (const initiative of feed.initiatives ?? []) {
    if (initiative.finished || !teamIds.has(initiative.teamId)) continue;
    if (current && current.instanceId === initiative.instanceId && current.initiativeId === initiative.id)
      continue;
    if (choices.some((known) => isSameInitiative(known, initiative))) continue;
    choices.push(initiative);
  }
  return choices.sort((left, right) => left.name.localeCompare(right.name));
}

export function selectTaskTeamInitiative(feed: TeamFeedSnapshot, task: Task) {
  const ref = task.teamInitiative;
  if (!ref) return null;
  return (
    (feed.initiatives ?? []).find(
      (initiative) =>
        initiative.teamId === ref.teamId &&
        initiative.instanceId === ref.instanceId &&
        initiative.id === ref.initiativeId
    ) ?? null
  );
}

export function selectLeadTeamInitiative(feed: TeamFeedSnapshot, task: Pick<Task, 'id'>) {
  return (feed.initiatives ?? []).find((initiative) => initiative.leadTaskId === task.id) ?? null;
}

export function resolveTeamLeadTarget(initiative: TeamFeedInitiative): TeamViewTarget {
  return { teamId: initiative.teamId, instanceId: initiative.instanceId, taskId: initiative.leadTaskId };
}

export function resolveTeamLeadPath(initiative: TeamFeedInitiative) {
  return resolveTeamTaskPath(resolveTeamLeadTarget(initiative));
}

export function isTeamInitiativeEntry(entry: TeamFeedTask, initiative: TeamFeedInitiative) {
  const ref = entry.initiative;
  if (!ref || entry.teamId !== initiative.teamId || entry.task.id === initiative.leadTaskId) return false;
  return ref.initiativeId === initiative.id && (ref.instanceId ?? entry.instanceId) === initiative.instanceId;
}

export function isOwnTeamInitiativeTask(task: Task, initiative: TeamFeedInitiative) {
  const ref = task.teamInitiative;
  return (
    ref?.teamId === initiative.teamId &&
    ref.instanceId === initiative.instanceId &&
    ref.initiativeId === initiative.id
  );
}

export function describeTeamInitiativeLabel(
  initiative: Pick<Initiative, 'phases' | 'name'>,
  phaseId: string | null
) {
  const phase = initiative.phases.find((each) => each.id === phaseId);
  return phase ? `${initiative.name} · ${phase.name}` : initiative.name;
}

export function listTeamShareChoices(initiative: Initiative, teams: readonly FocusTeam[]): TeamShareChoice[] {
  return teams.map((team) => ({ team, shared: isInitiativeInTeam(initiative, team.id) }));
}

function sendTeamJoin(task: Task, initiative: TeamFeedInitiative, phaseId: string | null, done: string) {
  return sendCommandWithToast(
    {
      type: 'task.join_initiative',
      taskId: task.id,
      initiativeId: initiative.id,
      phaseId,
      team: { teamId: initiative.teamId, instanceId: initiative.instanceId, name: initiative.name },
    },
    done
  );
}

export function joinTeamInitiative(task: Task, initiative: TeamFeedInitiative) {
  return sendTeamJoin(task, initiative, null, `Added to “${initiative.name}”.`);
}

export function changeTeamPhase(task: Task, initiative: TeamFeedInitiative, phaseId: string | null) {
  const phase = initiative.phases.find((each) => each.id === phaseId);
  return sendTeamJoin(
    task,
    initiative,
    phaseId,
    phase ? `Moved to the phase “${phase.name}”.` : 'Taken out of its phase.'
  );
}

export function leaveTeamInitiative(task: Task) {
  return sendCommandWithToast(
    { type: 'task.join_initiative', taskId: task.id, initiativeId: null, phaseId: null },
    `Taken out of “${task.teamInitiative?.name ?? TEAMMATE_INITIATIVE}”.`
  );
}

export function shareInitiative(initiative: Initiative, team: FocusTeam, shared: boolean) {
  if (shared) {
    return sendCommandWithToast(
      { type: 'initiative.add_to_team', initiativeId: initiative.id, teamId: team.id },
      `Shared with ${team.name}.`
    );
  }
  return sendCommandWithToast(
    { type: 'initiative.remove_from_team', initiativeId: initiative.id, teamId: team.id },
    `Stopped sharing with ${team.name}.`
  );
}
