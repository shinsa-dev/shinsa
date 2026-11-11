import {
  type Initiative,
  isSameTeamMembers,
  listInitiatives,
  listInitiativeTeamMembers,
  resolveTeamMembersKey,
  type ShinsaState,
  type TeamFeedSnapshot,
  type TeamFeedTask,
} from '@shinsa/core';
import type { TeamMembersUpdate } from './schema.ts';

function groupFeedTasks(feed: TeamFeedSnapshot) {
  const groups = new Map<string, { teamId: string; instanceId: string; tasks: TeamFeedTask[] }>();
  for (const task of feed.tasks) {
    const key = `${task.teamId} ${task.instanceId}`;
    const group = groups.get(key) ?? { teamId: task.teamId, instanceId: task.instanceId, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function listTeamMembers(initiative: Initiative, teamId: string) {
  return (initiative.teamMembers ?? []).filter((member) => member.teamId === teamId);
}

export function listTeamMembersUpdates(
  state: ShinsaState,
  self: string,
  feed: TeamFeedSnapshot
): TeamMembersUpdate[] {
  const groups = groupFeedTasks(feed);
  return listInitiatives(state).flatMap((initiative) => {
    if (!initiative.leadTaskId) return [];
    return (initiative.teamIds ?? []).flatMap((teamId) => {
      const members = groups
        .filter((group) => group.teamId === teamId)
        .flatMap((group) => listInitiativeTeamMembers(initiative, self, group));
      const previous = listTeamMembers(initiative, teamId);
      if (isSameTeamMembers(previous, members)) return [];
      return [{ initiativeId: initiative.id, teamId, previous, members }];
    });
  });
}

export function resolveTeamMembersId(update: TeamMembersUpdate) {
  const previous = resolveTeamMembersKey(update.previous);
  return `team-members:${update.initiativeId}:${update.teamId}:${previous}:${resolveTeamMembersKey(update.members)}`;
}
