import { describeList, type Project, type TeamJoinStatus, type UserCommand } from '@shinsa/core';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { DeviceStore, EnrolledDevice } from '@/lib/remote/devices.ts';
import type { FleetMember } from '@/lib/remote/fleet.ts';
import { RemoteLink, type RemoteLinkOptions } from '@/lib/remote/link.ts';
import { listMachineRows, type MachineRow } from '@/lib/remote/machines.ts';
import { listProjectChoices, type ProjectChoice } from './settings.ts';

export const JOIN_PATH = '/api/remote/teams/join';

export const PROJECTS_PATH = '/api/projects';

export const COMMANDS_PATH = '/api/commands';

const PROJECTS_TIMEOUT_MS = 4000;

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

type JoinFetch = Pick<FleetMember, 'id' | 'name' | 'fetch'>;

export function listJoinRows(rows: readonly MachineRow[]) {
  return rows.filter(
    (row): row is JoinRow =>
      row.instance.role === 'owner' && row.instance.online && row.device !== null && !row.device.waiting
  );
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

async function readAnswer<T>(response: Response) {
  const answer = (await readJson(response)) as (T & { error?: { message?: string } }) | null;
  if (response.ok && answer) return answer;
  throw new Error(answer?.error?.message ?? `Shinsa answered with status ${response.status}.`);
}

async function readJoinAnswer(response: Response) {
  const answer = await readAnswer<{ teamId?: string; status?: TeamJoinStatus }>(response);
  if (typeof answer.teamId === 'string') return answer.teamId;
  throw new Error(`Shinsa answered with status ${response.status}.`);
}

function postJson(origin: string, path: string, body: unknown) {
  return new Request(new URL(path, origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readJoinProjects(member: Pick<FleetMember, 'fetch'>, origin: string) {
  const answer = await readAnswer<{ projects?: Project[] }>(
    await member.fetch(new Request(new URL(PROJECTS_PATH, origin)))
  );
  const projects = Object.fromEntries((answer.projects ?? []).map((project) => [project.id, project]));
  return listProjectChoices({ projects });
}

export function createJoinMachine(member: JoinFetch, projects: ProjectChoice[], origin: string): JoinMachine {
  return {
    id: member.id,
    name: member.name,
    projects,
    share: async (url, projectIds) => {
      if (projectIds.length === 0) return;
      const teamId = await readJoinAnswer(await member.fetch(postJson(origin, JOIN_PATH, { url })));
      for (const command of listJoinCommands(teamId, projectIds)) {
        await readAnswer(await member.fetch(postJson(origin, COMMANDS_PATH, command)));
      }
    },
  };
}

function resolveWithin<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

interface JoinMember {
  member: JoinFetch;
  close: () => void;
}

type JoinRow = MachineRow & { device: EnrolledDevice };

type JoinDashboard = Pick<DashboardClient, 'requestConnect'>;

export function createJoinMember(
  row: JoinRow,
  dashboard: JoinDashboard,
  openChannel?: RemoteLinkOptions['openChannel']
): JoinMember {
  const link: RemoteLink = new RemoteLink({
    instanceId: row.instance.id,
    device: row.device,
    dashboard,
    onRefused: () => link.close(),
    ...(openChannel ? { openChannel } : {}),
  });
  return {
    member: { id: row.instance.id, name: row.instance.name, fetch: (request) => link.fetch(request) },
    close: () => link.close(),
  };
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
    const origin = options.origin ?? location.origin;
    const rows = listJoinRows(await listMachineRows(services.dashboard, services.devices));
    const closers: (() => void)[] = [];
    const machines = await Promise.all(
      rows.map(async (row) => {
        const entry = createMember(row, services.dashboard);
        closers.push(entry.close);
        const projects = await resolveWithin(
          readJoinProjects(entry.member, origin),
          options.timeoutMs ?? PROJECTS_TIMEOUT_MS
        );
        if (!projects) return null;
        return createJoinMachine(entry.member, projects, origin);
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
