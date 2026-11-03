import { DomainError, type RemoteTeamEntry, type RemoteUser } from '@shinsa/core';
import type { EngineCalls } from '../cli/client/schema.ts';
import type { RemoteSnapshot } from '../remote/index.ts';
import type { SurfaceClient } from './client.ts';
import type { FieldSpec } from './fields.ts';
import { defineAction, defineRead, readValue, type SurfaceSpec } from './spec.ts';

export const TEAM_FIELD: FieldSpec = {
  name: 'team',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The team’s name or id, from `shinsa teams list`.',
};

export const LOGIN_FIELD: FieldSpec = {
  name: 'login',
  kind: 'text',
  required: true,
  description: 'Their GitHub login, from `shinsa teams list`.',
};

function describeUser(user: RemoteUser) {
  return user.name ? `${user.name} (${user.login})` : user.login;
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
  const snapshot = await client.api.remote.snapshot();
  const wanted = ref.trim().toLowerCase();
  const matches = snapshot.teams.filter(
    (entry) => entry.id === ref.trim() || entry.name.toLowerCase() === wanted
  );
  const [found] = matches;
  if (found && matches.length === 1) return found.id;
  const problem =
    matches.length > 1 ? `More than one team is called ${ref}; name it by its id` : `No team matches ${ref}`;
  throw new DomainError({
    code: 'team_not_found',
    message: `${problem}. See them with \`shinsa teams list\`.`,
  });
}

type Among = 'members' | 'requests' | 'teammates';

export async function findTeamUser(client: SurfaceClient, teamId: string, login: string, among: Among) {
  const snapshot = await client.api.remote.snapshot();
  const team = snapshot.teams.find((entry) => entry.id === teamId)?.team;
  const wanted = login.replace(/^@/, '').toLowerCase();
  const listed = team && (among === 'teammates' ? [{ user: team.owner }, ...team.members] : team[among]);
  const found = listed?.find((entry) => entry.user.login.toLowerCase() === wanted);
  if (!found) {
    const where = among === 'requests' ? 'has not asked to join this team' : 'is not in this team';
    throw new DomainError({
      code: 'member_not_found',
      message: `${wanted} ${where}. See the team with \`shinsa teams list\`.`,
    });
  }
  return found.user;
}

type TeamRoute = (api: EngineCalls, payload: { teamId: string }) => Promise<unknown>;

type MemberRoute = (api: EngineCalls, payload: { teamId: string; userId: string }) => Promise<unknown>;

function defineTeamAction(path: string, summary: string, route: TeamRoute, done: string): SurfaceSpec {
  return defineAction({
    path: ['teams', path],
    summary,
    humanOnly: true,
    fields: [TEAM_FIELD],
    act: async (client, values) => {
      const teamId = await findTeamId(client, readValue(values, 'team'));
      const data = await route(client.api, { teamId });
      return { data, text: done };
    },
  });
}

function defineMemberAction(
  path: string,
  summary: string,
  route: MemberRoute,
  among: Among,
  done: string
): SurfaceSpec {
  return defineAction({
    path: ['teams', path],
    summary,
    humanOnly: true,
    fields: [TEAM_FIELD, LOGIN_FIELD],
    act: async (client, values) => {
      const teamId = await findTeamId(client, readValue(values, 'team'));
      const { id: userId } = await findTeamUser(client, teamId, readValue(values, 'login'), among);
      const data = await route(client.api, { teamId, userId });
      return { data, text: done };
    },
  });
}

function describeLink(url: string) {
  return `Share this link with your teammates. Whoever opens it signs in with GitHub and asks to join, which you accept or decline:\n${url}`;
}

export const TEAM_SPECS: SurfaceSpec[] = [
  defineRead({
    path: ['teams', 'list'],
    summary: 'List the teams this machine is in, with their members and who asks to join.',
    fields: [],
    read: (_values, client) => client.api.remote.snapshot(),
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
      const data = await client.api.teams.create({
        payload: {
          name: readValue(values, 'name'),
        },
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
      const data = await client.api.teams.join({
        payload: {
          url: readValue(values, 'url'),
        },
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
      const data = await client.api.teams.link({ payload: { teamId } });
      return { data, text: describeLink(data.url) };
    },
  }),
  defineTeamAction(
    'link-off',
    'Turn a team’s link off, so nobody can ask to join with it any more.',
    (api, payload) => api.teams.removeLink({ payload }),
    'The team’s link is off.'
  ),
  defineMemberAction(
    'accept',
    'Accept someone who asked to join a team you own.',
    (api, payload) => api.teams.acceptRequest({ payload }),
    'requests',
    'They are in the team now and see the tasks of its projects.'
  ),
  defineMemberAction(
    'decline',
    'Decline someone who asked to join a team you own.',
    (api, payload) => api.teams.declineRequest({ payload }),
    'requests',
    'Declined.'
  ),
  defineMemberAction(
    'remove-member',
    'Take someone out of a team you own. Their views of its tasks close at once.',
    (api, payload) => api.teams.removeMember({ payload }),
    'members',
    'They are no longer in the team.'
  ),
  defineMemberAction(
    'grant',
    'Give a teammate full remote access to this machine. Their browsers that hold the team’s key are added without asking.',
    (api, payload) => api.remote.grantMember({ payload }),
    'teammates',
    'They can reach this machine now. Take it back with `shinsa remote remove-member`.'
  ),
  defineTeamAction(
    'leave',
    'Leave a team. Your projects stop showing their tasks to it.',
    (api, payload) => api.teams.leave({ payload }),
    'You left the team.'
  ),
  defineTeamAction(
    'remove',
    'Delete a team you own, for every member.',
    (api, payload) => api.teams.remove({ payload }),
    'The team is deleted.'
  ),
];
