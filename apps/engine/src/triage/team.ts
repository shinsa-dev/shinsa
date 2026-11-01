import {
  isTaskSettled,
  type Project,
  type RemoteTeam,
  type TaskStage,
  type TeamFeedSnapshot,
  type TeammateOriginal,
  type UnreachedTeammate,
} from '@shinsa/core';

export interface TeamReading {
  feed: TeamFeedSnapshot;
  teams: readonly RemoteTeam[];
  self: string | null;
}

export type TeamReader = () => TeamReading;

export interface TeammateTask {
  key: string;
  original: TeammateOriginal;
  stage: TaskStage;
  request: string;
  goal: string | null;
}

export interface TeammateCheck {
  tasks: TeammateTask[];
  unreached: UnreachedTeammate[];
}

export const TEAMMATE_KEY_PREFIX = 'teammate-';

export const TEAMMATE_TEXT_LIMIT = 280;

function clipText(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > TEAMMATE_TEXT_LIMIT ? `${flat.slice(0, TEAMMATE_TEXT_LIMIT).trimEnd()}…` : flat;
}

function resolveMemberLogin(teams: readonly RemoteTeam[], teamId: string, userId: string) {
  const team = teams.find((candidate) => candidate.id === teamId);
  if (!team) return null;
  if (team.owner.id === userId) return team.owner.login;
  return team.members.find((member) => member.user.id === userId)?.user.login ?? null;
}

export function resolveTeammateCheck(project: Project | null, reading: TeamReading): TeammateCheck | null {
  const teamIds = new Set(project?.teamIds ?? []);
  if (teamIds.size === 0) return null;
  const { feed, teams } = reading;
  const machines = feed.machines.filter((machine) => teamIds.has(machine.teamId));
  const owners = new Map(
    machines.map((machine) => [machine.instanceId, resolveMemberLogin(teams, machine.teamId, machine.userId)])
  );
  const seen = new Set<string>();
  const tasks: TeammateTask[] = [];
  for (const listing of feed.tasks) {
    const id = `${listing.instanceId} ${listing.task.id}`;
    if (!teamIds.has(listing.teamId) || isTaskSettled(listing.task) || seen.has(id)) continue;
    seen.add(id);
    tasks.push({
      key: `${TEAMMATE_KEY_PREFIX}${tasks.length + 1}`,
      original: {
        teamId: listing.teamId,
        machineId: listing.instanceId,
        taskId: listing.task.id,
        handle: listing.task.handle ?? null,
        title: listing.task.title,
        owner: listing.owner ?? owners.get(listing.instanceId) ?? null,
      },
      stage: listing.task.stage,
      request: clipText(listing.task.request),
      goal: listing.task.plan?.document?.goal ? clipText(listing.task.plan.document.goal) : null,
    });
  }
  const live = new Set(
    machines.filter((machine) => machine.status === 'live').map((machine) => machine.instanceId)
  );
  const listed = new Set<string>();
  const unreached: UnreachedTeammate[] = [];
  const candidates = [
    ...teams
      .filter((team) => teamIds.has(team.id))
      .flatMap((team) =>
        team.machines.map((machine) => ({
          teamId: team.id,
          machineId: machine.id,
          name: machine.name,
          owner: resolveMemberLogin(teams, team.id, machine.userId),
        }))
      ),
    ...machines.map((machine) => ({
      teamId: machine.teamId,
      machineId: machine.instanceId,
      name: machine.name,
      owner: owners.get(machine.instanceId) ?? null,
    })),
  ];
  for (const candidate of candidates) {
    if (
      candidate.machineId === reading.self ||
      live.has(candidate.machineId) ||
      listed.has(candidate.machineId)
    ) {
      continue;
    }
    listed.add(candidate.machineId);
    unreached.push(candidate);
  }
  return { tasks, unreached };
}
