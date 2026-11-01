import {
  createState,
  type Project,
  type RemoteSnapshot,
  type RemoteTeam,
  type ShinsaState,
  type TeamJoinFragment,
} from '@shinsa/core';
import type { TeamActions } from '@/lib/connection/teams.ts';
import type { TeamJoinResult } from '@/lib/teams/join.ts';
import type { JoinMachines } from '@/lib/teams/join-machines.ts';

const HOUR_MS = 3_600_000;

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI = { id: '2', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const BOB = { id: '4', login: 'bob', name: 'Bob Stone', avatarUrl: null };

const LEE = { id: '3', login: 'lee', name: 'Lee Park', avatarUrl: null };

export const SAMPLE_TEAM_LINK: TeamJoinFragment = {
  teamId: 'tm4k2q',
  invite: 'aW52aXRlLXRva2Vu',
  key: 'BHq2f0pCrDqGkQ4w7sYhJ1nT8vU3mZkL9xRbE6aW5cO',
};

const SAMPLE_TEAM_URL = `https://app.shinsa.dev/share/team#${SAMPLE_TEAM_LINK.teamId}.${SAMPLE_TEAM_LINK.invite}.${SAMPLE_TEAM_LINK.key}`;

function createProject(id: string, name: string, color: Project['color'], teamIds: string[] = []): Project {
  return { id, name, key: name.slice(0, 2).toUpperCase(), color, description: '', folders: [], teamIds };
}

export function createSampleTeams(now: number) {
  const platform: RemoteTeam = {
    id: 'tm4k2q',
    name: 'Platform',
    owner: MONA,
    role: 'owner',
    members: [{ user: KAI, addedAt: now - 30 * HOUR_MS }],
    requests: [{ user: BOB, addedAt: now - 4 * 60_000 }],
    machines: [],
    createdAt: now - 72 * HOUR_MS,
  };
  const paywalls: RemoteTeam = {
    id: 'tm8r1v',
    name: 'Paywalls',
    owner: LEE,
    role: 'member',
    members: [
      { user: MONA, addedAt: now - 20 * HOUR_MS },
      { user: KAI, addedAt: now - 6 * HOUR_MS },
    ],
    requests: [],
    machines: [],
    createdAt: now - 240 * HOUR_MS,
  };
  const state: ShinsaState = {
    ...createState(),
    projects: {
      shinsa: createProject('shinsa', 'Shinsa', 'blue', ['tm4k2q']),
      cloud: createProject('cloud', 'Shinsa Cloud', 'purple', ['tm4k2q']),
      paywall: createProject('paywall', 'Paywall editor', 'orange', ['tm8r1v']),
      notes: createProject('notes', 'Personal notes', 'green'),
    },
  };
  const base: RemoteSnapshot = {
    paired: true,
    enabled: true,
    status: 'connected',
    instanceId: 'k3x9',
    owner: 'mona',
    machineName: 'Studio',
    machineKey: 'machine-key',
    pairing: null,
    devices: [],
    access: { owner: MONA, members: [{ user: LEE, addedAt: now - 48 * HOUR_MS }] },
    link: null,
    requests: [],
    teams: [],
  };
  return {
    state,
    scenes: [
      {
        label:
          'TeamsGroup · a team you own with a request waiting, a team you are in, and a request you sent',
        snapshot: {
          ...base,
          teams: [
            {
              id: platform.id,
              name: platform.name,
              status: 'member',
              onMachine: true,
              invite: true,
              team: platform,
            },
            {
              id: paywalls.id,
              name: paywalls.name,
              status: 'member',
              onMachine: true,
              invite: false,
              team: paywalls,
            },
            { id: 'tm2z7c', name: 'Mobile', status: 'requested', onMachine: true, invite: false, team: null },
          ],
        },
      },
      { label: 'TeamsGroup · in no team yet', snapshot: base },
      {
        label: 'TeamsGroup · remote access is off',
        snapshot: { ...base, paired: false, enabled: false, status: 'off', owner: null },
      },
    ] satisfies { label: string; snapshot: RemoteSnapshot }[],
  };
}

export function createSampleTeamActions(): TeamActions {
  const refuse = () => Promise.reject(new Error('This is a sample. Nothing changes here.'));
  return {
    create: refuse,
    join: refuse,
    writeProjects: refuse,
    readLink: () => Promise.resolve({ url: SAMPLE_TEAM_URL }),
    removeLink: refuse,
    acceptRequest: refuse,
    declineRequest: refuse,
    removeMember: refuse,
    leave: refuse,
    remove: refuse,
    grantAccess: refuse,
  };
}

export function requestSampleTeamJoin(): Promise<TeamJoinResult> {
  return Promise.resolve({ name: 'Platform', owner: 'Mona Lisa', status: 'requested' });
}

export const SAMPLE_TEAM_JOIN_DASHBOARD = {
  joinTeam: () => Promise.reject(new Error('This is a sample.')),
  previewTeam: () => Promise.resolve({ name: 'Platform', owner: MONA }),
};

export function openSampleJoinMachines(): Promise<JoinMachines> {
  return Promise.resolve({
    machines: [
      {
        id: 'k3x9',
        name: 'Studio',
        projects: [
          { id: 'paywalls', name: 'Paywalls', color: 'blue' },
          { id: 'web', name: 'Web', color: 'green' },
        ],
        share: () => Promise.resolve(),
      },
    ],
    close: () => undefined,
  });
}
