import {
  listTeamProjectIds,
  parseTeamJoinUrl,
  type RemoteMember,
  type RemoteSnapshot,
  type RemoteTeam,
  type RemoteTeamEntry,
  type RemoteUser,
  type ShinsaState,
  TEAM_NAME_LIMIT,
  type UserCommand,
} from '@shinsa/core';
import { formatSince } from '@/lib/format/time.ts';
import type { Mention } from '@/lib/remote/users.ts';

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

export function describeTeamEntry(entry: RemoteTeamEntry, now = Date.now()): Mention {
  const { team } = entry;
  if (!team) return ['You asked to join. The team’s owner has not answered yet.'];
  const facts = ` · ${describeTeamFacts(team, now)}`;
  return team.role === 'owner' ? [`You own it${facts}`] : ['Owned by ', { user: team.owner }, facts];
}

export function describeTeamFacts(team: NonNullable<RemoteTeamEntry['team']>, now = Date.now()) {
  const people = team.members.length + 1;
  return `${people} ${people === 1 ? 'person' : 'people'} · ${formatSince('Made', team.createdAt, now)}`;
}

export function needsTeamLink(entry: RemoteTeamEntry) {
  return entry.team !== null && !entry.onMachine;
}

export function listProjectChoices(state: Pick<ShinsaState, 'projects'>): ProjectChoice[] {
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

export const TEAM_PROJECTS_REQUIRED = 'Pick at least one project to share with the team.';

export function validateTeamLinkProjects(projects: readonly ProjectChoice[], chosen: readonly string[]) {
  if (projects.length === 0) return null;
  return chosen.some((id) => projects.some((project) => project.id === id)) ? null : TEAM_PROJECTS_REQUIRED;
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

export const PEOPLE_SEARCH_MIN = 6;

export const PEOPLE_SEARCH_LABEL = 'Search people';

export interface TeamPerson {
  user: RemoteUser;
  member: RemoteMember | null;
}

export function listTeamPeople(team: RemoteTeam, query: string): TeamPerson[] {
  const people: TeamPerson[] = [
    { user: team.owner, member: null },
    ...team.members.map((member) => ({ user: member.user, member })),
  ];
  const words = query.trim().toLowerCase();
  if (!words) return people;
  return people.filter((person) =>
    [person.user.login, person.user.name ?? ''].some((text) => text.toLowerCase().includes(words))
  );
}

export function describePeopleCount(team: RemoteTeam) {
  return String(team.members.length + 1);
}
