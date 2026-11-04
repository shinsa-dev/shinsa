import { describeList, type UserCommand } from '@shinsa/core';
import { type Duration, Effect, Option } from 'effect';
import { HttpClientRequest } from 'effect/http';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { DeviceStore } from '@/lib/remote/devices.ts';
import type { FleetMember } from '@/lib/remote/fleet.ts';
import { createRemoteLink, type RemoteLinkOptions } from '@/lib/remote/link.ts';
import { listMachineRows, type MachineRow } from '@/lib/remote/machines.ts';
import type { EnrolledDevice } from '@/lib/remote/schema.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { decodeAnswer } from '@/lib/runtime/engine/answers.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { sendThrough } from '@/lib/runtime/fetch.ts';
import { enterPromise } from '@/lib/runtime/promise.ts';
import { JoinedTeam, PROJECTS_TIMEOUT } from './schema.ts';
import { listProjectChoices, type ProjectChoice } from './settings.ts';

export { COMMANDS_PATH, JOIN_PATH, PROJECTS_PATH } from './schema.ts';

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

export function onMachine(member: Pick<FleetMember, 'fetch'>, origin: string) {
  return <A, E>(effect: Effect.Effect<A, E, EngineClient>) =>
    effect.pipe(
      Effect.provide(EngineClient.through(HttpClientRequest.prependUrl(origin))),
      sendThrough(member.fetch)
    );
}

const decodeJoined = decodeAnswer(JoinedTeam);

const shareFrom = Effect.fn('JoinMachines.share')(function* (url: string, projectIds: readonly string[]) {
  if (projectIds.length === 0) return;
  const engine = yield* EngineClient;
  const { teamId } = yield* decodeJoined(yield* engine.teams.join({ payload: { url } }));
  for (const command of listJoinCommands(teamId, projectIds))
    yield* engine.commands.send({ headers: {}, payload: command });
});

const readProjects = Effect.fn('JoinMachines.readProjects')(function* () {
  const engine = yield* EngineClient;
  const answer = yield* engine.state.projects();
  return listProjectChoices({
    projects: Object.fromEntries(answer.projects.map((project) => [project.id, project])),
  });
});

export function createJoinMachine(member: JoinFetch, projects: ProjectChoice[], origin: string): JoinMachine {
  const through = onMachine(member, origin);
  return {
    id: member.id,
    name: member.name,
    projects,
    share: (url, projectIds) => runApp(through(shareFrom(url, projectIds))),
  };
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
  const link = createRemoteLink({
    instanceId: row.instance.id,
    device: row.device,
    dashboard,
    onRefused: () => link.close(),
    ...(openChannel ? { openChannel } : {}),
  });
  return {
    member: { id: row.instance.id, name: row.instance.name, fetch: link.fetch },
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
    timeout?: Duration.Input;
    createMember?: (row: JoinRow, dashboard: JoinDashboard) => JoinMember;
  } = {}
): OpenJoinMachines {
  const createMember = options.createMember ?? createJoinMember;
  const timeout = options.timeout ?? PROJECTS_TIMEOUT;
  const open = Effect.fn('JoinMachines.open')(function* () {
    const origin = options.origin ?? location.origin;
    const rows = listJoinRows(yield* listMachineRows(services.dashboard, services.devices));
    const closers: (() => void)[] = [];
    const machines = yield* Effect.forEach(
      rows,
      (row) => {
        const entry = createMember(row, services.dashboard);
        closers.push(entry.close);
        return onMachine(
          entry.member,
          origin
        )(readProjects()).pipe(
          Effect.timeoutOption(timeout),
          Effect.map(Option.map((projects) => createJoinMachine(entry.member, projects, origin))),
          Effect.orElseSucceed(Option.none)
        );
      },
      { concurrency: 'unbounded' }
    );
    return {
      machines: machines.flatMap((machine) => Option.toArray(machine)),
      close: () => {
        for (const close of closers.splice(0)) close();
      },
    };
  });
  return () => runApp(open());
}

export type JoinPicks = Readonly<Record<string, readonly string[]>>;

export function countJoinPicks(picks: JoinPicks) {
  return Object.values(picks).reduce((total, projectIds) => total + projectIds.length, 0);
}

export function shareJoinPicks(machines: readonly JoinMachine[], picks: JoinPicks, url: string) {
  return runApp(
    Effect.forEach(machines, (machine) => enterPromise(() => machine.share(url, picks[machine.id] ?? [])), {
      discard: true,
    })
  );
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
