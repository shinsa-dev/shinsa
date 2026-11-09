import {
  listTeamProjectIds,
  NO_TEAM_FEED,
  type RemoteMember,
  type RemoteSnapshot,
  type RemoteTeam,
  type RemoteTeamEntry,
  type RemoteUser,
  type ShinsaState,
  TEAM_NAME_LIMIT,
  TEAM_REFUSALS,
  type TeamFeedMachine,
  type TeamFeedSnapshot,
  type TeamMachine,
  type UserCommand,
} from '@shinsa/core';
import { formatSince } from '@/lib/format/time.ts';
import type { Mention } from '@/lib/remote/users.ts';
import { isMachineOnline, resolveMachineSeenAt, selectFeedMachine } from './presence.ts';

export const TEAMS_SECTION = 'Teams';

export const TEAMS_DESCRIPTION =
  'Teammates see every task in the projects you share with a team, live, and act on it as far as What teammates can do allows. You choose the projects, and only you.';

export const TEAM_LINK_COPY =
  'Whoever opens it asks to join, which you accept here. It holds the team’s key, so share it only with people you’d add.';

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

export function describeTeamEntry(entry: RemoteTeamEntry, feed: TeamFeedSnapshot = NO_TEAM_FEED): Mention {
  const { team } = entry;
  if (!team) return ['You asked to join. The team’s owner has not answered yet.'];
  return describeTeamRole(team, ` · ${describeTeamFacts(team, feed)}`);
}

function describeTeamRole(team: RemoteTeam, facts: string): Mention {
  return team.role === 'owner' ? [`You own it${facts}`] : ['Owned by ', { user: team.owner }, facts];
}

function countOnlinePeople(team: RemoteTeam, feed: TeamFeedSnapshot = NO_TEAM_FEED) {
  const online = team.machines.filter((machine) =>
    isMachineOnline(machine, selectFeedMachine(feed, team.id, machine.id))
  );
  return new Set(online.map((machine) => machine.userId)).size;
}

export function describeTeamFacts(team: RemoteTeam, feed: TeamFeedSnapshot = NO_TEAM_FEED) {
  return `${countOf(team.members.length + 1, 'person', 'people')} · ${countOnlinePeople(team, feed)} online`;
}

export function needsTeamLink(entry: RemoteTeamEntry) {
  return entry.team !== null && !entry.onMachine;
}

const NO_KEYLESS_MACHINES: ReadonlySet<string> = new Set();

export function listKeylessMachines(
  entry: Pick<RemoteTeamEntry, 'onMachine'>,
  snapshot: Pick<RemoteSnapshot, 'instanceId'>
): ReadonlySet<string> {
  if (entry.onMachine || snapshot.instanceId === null) return NO_KEYLESS_MACHINES;
  return new Set([snapshot.instanceId]);
}

export const TEAM_SHARES_NOTHING =
  'Teammates see nothing from this machine until you share a project with the team.';

export const TEAM_KEY_WAITING = 'Teammates cannot see this machine’s tasks until it gets access.';

export const TEAM_KEY_UPDATE = 'Teammates cannot see this machine’s tasks. Update Shinsa to get access.';

export function describeKeyAsked(team: RemoteTeam): Mention {
  return ['Asked. ', { user: team.owner }, ' gives this machine access from Settings → Teams.'];
}

export function describeKeyRequest(machine: TeamFeedMachine, team: RemoteTeam): Mention {
  const owner = selectTeamPerson(team, machine.userId);
  const by: Mention = owner ? [' by ', { user: owner }] : [];
  return [`“${machine.name}”`, ...by, ' asks for access to this team’s tasks'];
}

export function listKeyRequests(feed: TeamFeedSnapshot, teamId: string) {
  return feed.machines.filter((machine) => machine.teamId === teamId && machine.asking);
}

export function listProjectChoices(state: Pick<ShinsaState, 'projects'>): ProjectChoice[] {
  return Object.values(state.projects)
    .map((project) => ({ id: project.id, name: project.name, color: project.color }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function scopeStateToProjects(state: ShinsaState, projectIds: readonly string[]): ShinsaState {
  const kept = new Set(projectIds);
  return {
    ...state,
    projects: Object.fromEntries(Object.entries(state.projects).filter(([id]) => kept.has(id))),
  };
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

export function hasMachineAccess(snapshot: RemoteSnapshot, userId: string) {
  return snapshot.access?.members.some((member) => member.user.id === userId) ?? false;
}

export interface GrantMachine {
  id: string | null;
  name: string;
}

export function listGrantMachines(
  machines: readonly { id: string; name: string; remote: RemoteSnapshot | null }[],
  current: GrantMachine,
  userId: string
): GrantMachine[] {
  const others = machines.filter(
    (machine) =>
      machine.id !== current.id &&
      machine.remote?.enabled === true &&
      !hasMachineAccess(machine.remote, userId)
  );
  return [current, ...others.map((machine) => ({ id: machine.id, name: machine.name }))];
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

export const NO_TEAM_MACHINES = 'No machines';

export function hasNoTeamMachines(team: Pick<RemoteTeam, 'machines'>, userId: string) {
  return !team.machines.some((machine) => machine.userId === userId);
}

export function describePeopleCount(team: RemoteTeam) {
  return String(team.members.length + 1);
}

export const TEAMS_ON_MACHINE_NOTE = 'Make and change a team from a machine you own.';

export const TEAM_KEY_MISSING =
  'Add one of your machines in this team to this browser to read its tasks here. Its team key comes with it.';

export const TEAMS_CONNECTING = 'Reading your teams from your machines…';

export const NO_HOSTED_TEAM =
  'You are in no team yet. Make one in Settings on a machine, or open a teammate’s join link here and sign in to ask to join.';

export function describeHostedTeamsNotice(teams: HostedTeams | null, failure: string | null) {
  if (failure) return failure;
  if (!teams) return 'Reading your teams…';
  return NO_HOSTED_TEAM;
}

export interface HostedTeam {
  team: RemoteTeam;
  hasKey: boolean;
}

export function showsKeyNote(entry: HostedTeam) {
  return !entry.hasKey && entry.team.role !== 'owner';
}

export interface HostedTeams {
  viewerId: string | null;
  teams: HostedTeam[];
}

export function replaceHostedTeam(teams: HostedTeams, team: RemoteTeam): HostedTeams {
  return {
    ...teams,
    teams: teams.teams.map((entry) => (entry.team.id === team.id ? { ...entry, team } : entry)),
  };
}

function countOf(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function describeHostedTeam(team: RemoteTeam, feed: TeamFeedSnapshot = NO_TEAM_FEED): Mention {
  const machines = countOf(team.machines.length, 'machine', 'machines');
  return describeTeamRole(team, ` · ${describeTeamFacts(team, feed)} · ${machines}`);
}

export type TeamMachineTone = 'online' | 'warning' | 'quiet';

export interface TeamMachineRow {
  machine: TeamMachine;
  tone: TeamMachineTone;
  status: string;
  owner: RemoteUser | null;
}

export const TEAM_MACHINE_NEEDS_KEY = 'Waiting for the team’s key';

export function selectTeamPerson(team: Pick<RemoteTeam, 'owner' | 'members'>, userId: string) {
  if (team.owner.id === userId) return team.owner;
  return team.members.find((member) => member.user.id === userId)?.user ?? null;
}

export function listTeamMachineRows(
  team: RemoteTeam,
  now = Date.now(),
  feed: TeamFeedSnapshot = NO_TEAM_FEED,
  keyless: ReadonlySet<string> = NO_KEYLESS_MACHINES
): TeamMachineRow[] {
  return team.machines.map((machine): TeamMachineRow => {
    const live = selectFeedMachine(feed, team.id, machine.id);
    const owner = selectTeamPerson(team, machine.userId);
    if (keyless.has(machine.id) || (live?.status === 'refused' && live.reason === TEAM_REFUSALS.key))
      return { machine, tone: 'warning', status: TEAM_MACHINE_NEEDS_KEY, owner };
    const online = isMachineOnline(machine, live);
    const seenAt = resolveMachineSeenAt(machine, live);
    return {
      machine,
      tone: online ? 'online' : 'quiet',
      status: describeTeamMachineStatus(online, seenAt, now),
      owner,
    };
  });
}

function describeTeamMachineStatus(online: boolean, seenAt: number | null, now: number) {
  if (online) return 'Online';
  return seenAt === null ? 'Never connected' : formatSince('Last seen', seenAt, now);
}
