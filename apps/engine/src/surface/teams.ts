import { DomainError, type RemoteTeamEntry, type RemoteUser } from '@shinsa/core';
import type { RemoteSnapshot } from '../remote/index.ts';
import type { SurfaceClient } from './client.ts';
import type { FieldSpec } from './fields.ts';
import { defineAction, defineRead, readValue, type SurfaceSpec } from './spec.ts';

const TEAM_FIELD: FieldSpec = {
  name: 'team',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The team’s name or id, from `shinsa teams list`.',
};

const LOGIN_FIELD: FieldSpec = {
  name: 'login',
  kind: 'text',
  required: true,
  description: 'Their GitHub login, from `shinsa teams list`.',
};

function describeUser(user: RemoteUser) {
  return user.name ? `${user.name} (@${user.login})` : `@${user.login}`;
}

function describeEntry(entry: RemoteTeamEntry) {
  if (!entry.team) return [`${entry.name} (${entry.id}): you asked to join; its owner has not answered yet.`];
  const { team } = entry;
  const role = team.role === 'owner' ? 'you own it' : `owned by ${describeUser(team.owner)}`;
  const here = entry.onMachine ? '' : ' Open its link on this machine to show its tasks here.';
  const lines = [`${team.name} (${team.id}), ${role}.${here}`];
  lines.push(...team.members.map((member) => `  Member: ${describeUser(member.user)}`));
  lines.push(...team.requests.map((request) => `  Asks to join: ${describeUser(request.user)}`));
  return lines;
}

function formatTeams(snapshot: RemoteSnapshot) {
  if (!snapshot.paired)
    return 'Teams reach your teammates through remote access. Turn it on with `shinsa remote pair`.';
  if (snapshot.teams.length === 0)
    return 'This machine is in no team. Make one with `shinsa teams create`, or join one with `shinsa teams join`.';
  return snapshot.teams.flatMap(describeEntry).join('\n');
}

export async function findTeamId(client: SurfaceClient, ref: string) {
  const snapshot = await client.read<RemoteSnapshot>('/api/remote');
  const wanted = ref.trim().toLowerCase();
  const matches = snapshot.teams.filter(
    (entry) => entry.id === ref.trim() || entry.name.toLowerCase() === wanted
  );
  const [found] = matches;
  if (found && matches.length === 1) return found.id;
  const problem =
    matches.length > 1 ? `More than one team is called ${ref}; name it by its id` : `No team matches ${ref}`;
  throw new DomainError('team_not_found', `${problem}. See them with \`shinsa teams list\`.`);
}

async function findUserId(
  client: SurfaceClient,
  teamId: string,
  login: string,
  among: 'members' | 'requests'
) {
  const snapshot = await client.read<RemoteSnapshot>('/api/remote');
  const team = snapshot.teams.find((entry) => entry.id === teamId)?.team;
  const wanted = login.replace(/^@/, '').toLowerCase();
  const found = team?.[among].find((entry) => entry.user.login.toLowerCase() === wanted);
  if (!found) {
    const where = among === 'members' ? 'is not in this team' : 'has not asked to join this team';
    throw new DomainError(
      'member_not_found',
      `@${wanted} ${where}. See the team with \`shinsa teams list\`.`
    );
  }
  return found.user.id;
}

function defineTeamAction(path: string, summary: string, route: string, done: string): SurfaceSpec {
  return defineAction({
    path: ['teams', path],
    summary,
    humanOnly: true,
    fields: [TEAM_FIELD],
    act: async (client, values) => {
      const teamId = await findTeamId(client, readValue(values, 'team'));
      const data = await client.post<RemoteSnapshot>(route, { teamId });
      return { data, text: done };
    },
  });
}

function defineMemberAction(
  path: string,
  summary: string,
  route: string,
  among: 'members' | 'requests',
  done: string
): SurfaceSpec {
  return defineAction({
    path: ['teams', path],
    summary,
    humanOnly: true,
    fields: [TEAM_FIELD, LOGIN_FIELD],
    act: async (client, values) => {
      const teamId = await findTeamId(client, readValue(values, 'team'));
      const userId = await findUserId(client, teamId, readValue(values, 'login'), among);
      const data = await client.post<RemoteSnapshot>(route, { teamId, userId });
      return { data, text: done };
    },
  });
}

function describeLink(url: string) {
  return `Share this link with your teammates. Whoever opens it signs in with GitHub and asks to join, which you accept or decline:\n${url}`;
}

export const TEAM_SPECS: SurfaceSpec[] = [
  defineRead<RemoteSnapshot>({
    path: ['teams', 'list'],
    summary: 'List the teams this machine is in, with their members and who asks to join.',
    fields: [],
    request: () => '/api/remote',
    format: formatTeams,
  }),
  defineAction({
    path: ['teams', 'create'],
    summary: 'Make a team you own, and show the link that asks to join it.',
    humanOnly: true,
    fields: [
      {
        name: 'name',
        kind: 'text',
        positional: 'rest',
        required: true,
        description: 'The team’s name, 60 characters at most.',
      },
    ],
    act: async (client, values) => {
      const data = await client.post<{ teamId: string; url: string }>('/api/remote/teams/create', {
        name: readValue(values, 'name'),
      });
      return { data, text: describeLink(data.url) };
    },
  }),
  defineAction({
    path: ['teams', 'join'],
    summary: 'Ask to join a team with its link, or add a team you are in to this machine.',
    humanOnly: true,
    fields: [
      {
        name: 'url',
        kind: 'text',
        positional: 'one',
        required: true,
        description: 'The team link, https://app.shinsa.dev/share/team#…',
      },
    ],
    act: async (client, values) => {
      const data = await client.post<{ status: string }>('/api/remote/teams/join', {
        url: readValue(values, 'url'),
      });
      const text =
        data.status === 'member'
          ? 'This machine is in the team now. Add a project to it with `shinsa projects add-to-team`.'
          : 'You asked to join. The team’s owner accepts or declines.';
      return { data, text };
    },
  }),
  defineAction({
    path: ['teams', 'link'],
    summary: 'Show the link that asks to join a team you own, making a new one if it is off.',
    humanOnly: true,
    fields: [TEAM_FIELD],
    act: async (client, values) => {
      const teamId = await findTeamId(client, readValue(values, 'team'));
      const data = await client.post<{ url: string }>('/api/remote/teams/link', { teamId });
      return { data, text: describeLink(data.url) };
    },
  }),
  defineTeamAction(
    'link-off',
    'Turn a team’s link off, so nobody can ask to join with it any more.',
    '/api/remote/teams/link/remove',
    'The team’s link is off.'
  ),
  defineMemberAction(
    'accept',
    'Accept someone who asked to join a team you own.',
    '/api/remote/teams/requests/accept',
    'requests',
    'They are in the team now and see the tasks of its projects.'
  ),
  defineMemberAction(
    'decline',
    'Decline someone who asked to join a team you own.',
    '/api/remote/teams/requests/decline',
    'requests',
    'Declined.'
  ),
  defineMemberAction(
    'remove-member',
    'Take someone out of a team you own. Their views of its tasks close at once.',
    '/api/remote/teams/members/remove',
    'members',
    'They are no longer in the team.'
  ),
  defineTeamAction(
    'leave',
    'Leave a team. Your projects stop showing their tasks to it.',
    '/api/remote/teams/leave',
    'You left the team.'
  ),
  defineTeamAction(
    'remove',
    'Remove a team you own, for every member.',
    '/api/remote/teams/remove',
    'The team is removed.'
  ),
];
