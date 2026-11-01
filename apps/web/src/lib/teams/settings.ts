import {
  listTeamProjectIds,
  parseTeamJoinUrl,
  type RemoteSnapshot,
  type RemoteTeamEntry,
  type ShinsaState,
  TEAM_NAME_LIMIT,
  type UserCommand,
} from '@shinsa/core';
import { formatSince } from '@/lib/format/time.ts';
import { describeUserName } from '@/lib/remote/users.ts';

export const TEAMS_SECTION = 'Teams';

export const TEAMS_DESCRIPTION =
  'Teammates see every task in the projects you share with a team, live and read-only: its plan, review, evidence and code, never its chat. You choose the projects, and only you.';

export const TEAM_LINK_COPY =
  'Share this link with your teammates. Whoever opens it signs in with GitHub and asks to join, which you accept or decline here. It holds the team’s key, so send it only to people you would add.';

export interface ProjectChoice {
  id: string;
  name: string;
  color: string;
}

export function canUseTeams(snapshot: RemoteSnapshot | null): snapshot is RemoteSnapshot {
  return snapshot?.paired === true && snapshot.status !== 'revoked';
}

export function describeTeamsUnavailable(snapshot: RemoteSnapshot | null) {
  if (snapshot?.status === 'revoked')
    return 'This machine was removed in Shinsa Cloud. Turn remote access on again to use teams.';
  return 'Teams reach your teammates through remote access. Turn it on above first.';
}

export function describeTeamEntry(entry: RemoteTeamEntry, now = Date.now()) {
  const { team } = entry;
  if (!team) return 'You asked to join. The team’s owner has not answered yet.';
  const people = team.members.length + 1;
  const count = `${people} ${people === 1 ? 'person' : 'people'}`;
  const role = team.role === 'owner' ? 'You own it' : `Owned by ${describeUserName(team.owner)}`;
  return `${role} · ${count} · ${formatSince('Made', team.createdAt, now)}`;
}

export function needsTeamLink(entry: RemoteTeamEntry) {
  return entry.team !== null && !entry.onMachine;
}

export function listProjectChoices(state: ShinsaState): ProjectChoice[] {
  return Object.values(state.projects)
    .map((project) => ({ id: project.id, name: project.name, color: project.color }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function listTeamProjectCommands(
  state: ShinsaState,
  teamId: string,
  chosen: readonly string[]
): UserCommand[] {
  const current = new Set(listTeamProjectIds(state, teamId));
  const wanted = new Set(chosen.filter((id) => state.projects[id] !== undefined));
  const added = [...wanted].filter((id) => !current.has(id));
  const removed = [...current].filter((id) => !wanted.has(id));
  return [
    ...added.map((projectId): UserCommand => ({ type: 'project.add_to_team', projectId, teamId })),
    ...removed.map((projectId): UserCommand => ({ type: 'project.remove_from_team', projectId, teamId })),
  ];
}

export interface TeamDraft {
  name: string;
  projectIds: string[];
}

export function createTeamDraft(): TeamDraft {
  return { name: '', projectIds: [] };
}

export function validateTeamDraft(draft: TeamDraft): string | null {
  const name = draft.name.trim();
  if (!name) return 'Give the team a name.';
  if (name.length > TEAM_NAME_LIMIT) return `Keep the name to ${TEAM_NAME_LIMIT} characters.`;
  return null;
}

export function validateTeamLink(teamId: string, url: string): string | null {
  const link = parseTeamJoinUrl(url.trim());
  if (!link) return 'That is not a team link. Copy the whole link, with everything after the #.';
  if (link.teamId !== teamId) return 'That link is for another team.';
  return null;
}

export function hasMachineAccess(snapshot: RemoteSnapshot, userId: string) {
  return snapshot.access?.members.some((member) => member.user.id === userId) ?? false;
}

export function resolveProjectPick(projects: readonly ProjectChoice[], chosen: readonly string[]) {
  const picked = projects.filter((project) => chosen.includes(project.id));
  const [first, second] = picked;
  if (!first) return { dots: [], label: 'No projects' };
  const dots = picked.slice(0, 3);
  if (picked.length === 1) return { dots, label: first.name };
  if (picked.length === 2 && second) return { dots, label: `${first.name}, ${second.name}` };
  return { dots, label: `${first.name} and ${picked.length - 1} more` };
}
