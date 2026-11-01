import {
  describeList,
  type ShinsaState,
  type TeamJoinStatus,
  type UserCommand,
  type WireState,
} from '@shinsa/core';
import type { ShinsaConnection } from '@/lib/connection/socket.ts';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { DeviceStore, EnrolledDevice } from '@/lib/remote/devices.ts';
import type { FleetMember } from '@/lib/remote/fleet.ts';
import type { RemoteLinkOptions } from '@/lib/remote/link.ts';
import { createFleetMember, listMachineRows, type MachineRow } from '@/lib/remote/machines.ts';
import { listProjectChoices, type ProjectChoice } from './settings.ts';

export const JOIN_PATH = '/api/remote/teams/join';

const STATE_TIMEOUT_MS = 10_000;

export interface JoinMachine {
  id: string;
  name: string;
  projects: ProjectChoice[];
  share: (url: string, projectIds: readonly string[]) => Promise<void>;
}

export interface JoinMachines {
  machines: JoinMachine[];
  close: () => void;
}

export type OpenJoinMachines = () => Promise<JoinMachines>;

type MachineConnection = Pick<ShinsaConnection, 'start' | 'subscribe' | 'snapshot' | 'command'>;

export function listJoinRows(rows: readonly MachineRow[]) {
  return rows.filter(
    (row): row is JoinRow => row.instance.role === 'owner' && row.device !== null && !row.device.waiting
  );
}

export function waitForState(
  connection: Pick<ShinsaConnection, 'subscribe' | 'snapshot'>,
  timeoutMs: number
) {
  return new Promise<WireState | null>((resolve) => {
    let done = false;
    let stop: (() => void) | null = null;
    const finish = (state: WireState | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve(state);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const check = () => {
      const current = connection.snapshot().state;
      if (current) finish(current);
    };
    stop = connection.subscribe(check);
    check();
  });
}

export function listJoinCommands(teamId: string, projectIds: readonly string[]): UserCommand[] {
  return [...new Set(projectIds)].map((projectId) => ({ type: 'project.add_to_team', projectId, teamId }));
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readJoinAnswer(response: Response) {
  const answer = (await readJson(response)) as {
    teamId?: string;
    status?: TeamJoinStatus;
    error?: { message?: string };
  } | null;
  if (response.ok && typeof answer?.teamId === 'string') return answer.teamId;
  throw new Error(answer?.error?.message ?? `Shinsa answered with status ${response.status}.`);
}

export function createJoinMachine(
  member: Pick<FleetMember, 'id' | 'name' | 'fetch'>,
  connection: Pick<ShinsaConnection, 'command'>,
  state: Pick<ShinsaState, 'projects'>,
  origin: string
): JoinMachine {
  return {
    id: member.id,
    name: member.name,
    projects: listProjectChoices(state),
    share: async (url, projectIds) => {
      if (projectIds.length === 0) return;
      const response = await member.fetch(
        new Request(new URL(JOIN_PATH, origin), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        })
      );
      const teamId = await readJoinAnswer(response);
      for (const command of listJoinCommands(teamId, projectIds)) await connection.command(command);
    },
  };
}

interface JoinMember {
  member: Pick<FleetMember, 'id' | 'name' | 'fetch'> & { connection: MachineConnection };
  close: () => void;
}

type JoinRow = MachineRow & { device: EnrolledDevice };

type JoinDashboard = Pick<DashboardClient, 'requestConnect'>;

export function createJoinMember(
  row: JoinRow,
  dashboard: JoinDashboard,
  openChannel?: RemoteLinkOptions['openChannel']
): JoinMember {
  const member = createFleetMember(row.instance, row.device, {
    dashboard,
    onRefused: () => member.close(),
    ...(openChannel ? { openChannel } : {}),
  });
  return { member, close: member.close };
}

export function createJoinMachinesSource(
  services: {
    dashboard: Pick<DashboardClient, 'listInstances' | 'requestConnect'>;
    devices: Pick<DeviceStore, 'selectDevice'>;
  },
  options: {
    origin?: string;
    timeoutMs?: number;
    createMember?: (row: JoinRow, dashboard: JoinDashboard) => JoinMember;
  } = {}
): OpenJoinMachines {
  const createMember = options.createMember ?? createJoinMember;
  return async () => {
    const rows = listJoinRows(await listMachineRows(services.dashboard, services.devices));
    const closers: (() => void)[] = [];
    const machines = await Promise.all(
      rows.map(async (row) => {
        const entry = createMember(row, services.dashboard);
        closers.push(entry.close);
        const { connection } = entry.member;
        connection.start();
        const state = await waitForState(connection, options.timeoutMs ?? STATE_TIMEOUT_MS);
        if (!state) return null;
        return createJoinMachine(entry.member, connection, state, options.origin ?? location.origin);
      })
    );
    return {
      machines: machines.filter((machine) => machine !== null),
      close: () => {
        for (const close of closers.splice(0)) close();
      },
    };
  };
}

export type JoinPicks = Readonly<Record<string, readonly string[]>>;

export function countJoinPicks(picks: JoinPicks) {
  return Object.values(picks).reduce((total, projectIds) => total + projectIds.length, 0);
}

export async function shareJoinPicks(machines: readonly JoinMachine[], picks: JoinPicks, url: string) {
  for (const machine of machines) await machine.share(url, picks[machine.id] ?? []);
}

export function describeJoinPicks(machines: readonly JoinMachine[], picks: JoinPicks) {
  const names = machines.flatMap((machine) =>
    machine.projects
      .filter((project) => picks[machine.id]?.includes(project.id))
      .map((project) => project.name)
  );
  if (names.length === 0) return null;
  return `You share ${describeList(names)} with the team.`;
}
