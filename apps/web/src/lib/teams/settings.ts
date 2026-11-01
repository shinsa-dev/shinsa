import {
  listTeamProjectIds,
  parseTeamJoinUrl,
  type RemoteSnapshot,
  type RemoteTeamEntry,
  type ShinsaState,
  TEAM_NAME_LIMIT,
  type TeamJoinStatus,
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
    .map((project) => ({ id: project.id, name: project.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function describeTeamProjects(state: ShinsaState, teamId: string) {
  const names = listTeamProjectIds(state, teamId)
    .map((id) => state.projects[id]?.name)
    .filter((name): name is string => name !== undefined)
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) return 'You share no project with it.';
  return `You share ${names.join(', ')}.`;
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

export function describeJoinOutcome(status: TeamJoinStatus) {
  return status === 'member' ? 'You are in the team.' : 'Request sent.';
}

export type TeamDialogMode = 'create' | 'join' | 'projects';

export interface TeamDraft {
  name: string;
  url: string;
  projectIds: string[];
}

export const TEAM_DIALOG: Record<
  TeamDialogMode,
  { title: string; description: string; action: string; projects: string }
> = {
  create: {
    title: 'New team',
    description:
      'Make a team you own. You get a link that asks to join it, and you accept or decline each teammate.',
    action: 'Make team',
    projects: 'Projects to share with the team',
  },
  join: {
    title: 'Join a team',
    description:
      'Paste the link a teammate sent you. The team’s owner accepts or declines, and this machine keeps the team’s key.',
    action: 'Ask to join',
    projects: 'Projects to share with the team',
  },
  projects: {
    title: 'Shared projects',
    description:
      'Teammates see every task in these projects, read-only. Taking a project out hides its tasks from them at once.',
    action: 'Save',
    projects: 'Projects',
  },
};

export function createTeamDraft(projectIds: readonly string[] = []): TeamDraft {
  return { name: '', url: '', projectIds: [...projectIds] };
}

export function toggleDraftProject(draft: TeamDraft, projectId: string, chosen: boolean): TeamDraft {
  const others = draft.projectIds.filter((id) => id !== projectId);
  return { ...draft, projectIds: chosen ? [...others, projectId] : others };
}

export function validateTeamDraft(mode: TeamDialogMode, draft: TeamDraft): string | null {
  if (mode === 'create') {
    const name = draft.name.trim();
    if (!name) return 'Give the team a name.';
    if (name.length > TEAM_NAME_LIMIT) return `Keep the name to ${TEAM_NAME_LIMIT} characters.`;
  }
  if (mode === 'join' && !parseTeamJoinUrl(draft.url))
    return 'That is not a team link. Copy the whole link, with everything after the #.';
  return null;
}
