import { describeList, type UserCommand } from '@shinsa/core';
import { type Duration, Effect, Option } from 'effect';
import { HttpClientRequest } from 'effect/http';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import { listSettledMachineRows, type SettleOptions } from '@/lib/remote/enroll.ts';
import type { FleetMember } from '@/lib/remote/fleet.ts';
import { createRemoteLink, type RemoteLinkOptions } from '@/lib/remote/link.ts';
import type { MachineRow } from '@/lib/remote/machines.ts';
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
  join: (url: string, projectIds: readonly string[]) => Promise<void>;
}

export type JoinSetup =
  | { kind: 'pair' }
  | { kind: 'add'; machines: string[] }
  | { kind: 'waiting'; machines: string[] }
  | { kind: 'offline'; machines: string[] };

export interface JoinMachines {
  machines: JoinMachine[];
  setup: JoinSetup | null;
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

export function resolveJoinSetup(rows: readonly MachineRow[], reached: number): JoinSetup | null {
  const own = rows.filter((row) => row.instance.role === 'owner');
  if (own.length === 0) return { kind: 'pair' };
  if (reached > 0) return null;
  const names = (keep: (row: MachineRow) => boolean) => own.filter(keep).map((row) => row.instance.name);
  const waiting = names((row) => Boolean(row.device?.waiting));
  if (waiting.length > 0) return { kind: 'waiting', machines: waiting };
  const missing = names((row) => row.device === null);
  if (missing.length > 0) return { kind: 'add', machines: missing };
  return { kind: 'offline', machines: names(() => true) };
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

const joinFrom = Effect.fn('JoinMachines.join')(function* (url: string, projectIds: readonly string[]) {
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
    join: (url, projectIds) => runApp(through(joinFrom(url, projectIds))),
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
  services: Pick<SettleOptions, 'dashboard' | 'devices'>,
  options: {
    origin?: string;
    timeout?: Duration.Input;
    createMember?: (row: JoinRow, dashboard: JoinDashboard) => JoinMember;
    openSocket: (url: string) => WebSocket;
  }
): OpenJoinMachines {
  const createMember = options.createMember ?? createJoinMember;
  const timeout = options.timeout ?? PROJECTS_TIMEOUT;
  const open = Effect.fn('JoinMachines.open')(function* () {
    const origin = options.origin ?? location.origin;
    const all = yield* listSettledMachineRows({
      ...services,
      openSocket: options.openSocket,
    });
    const rows = listJoinRows(all);
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
    const reached = machines.flatMap((machine) => Option.toArray(machine));
    return {
      machines: reached,
      setup: resolveJoinSetup(all, reached.length),
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

export function joinFromMachines(machines: readonly JoinMachine[], picks: JoinPicks, url: string) {
  return runApp(
    Effect.forEach(machines, (machine) => enterPromise(() => machine.join(url, picks[machine.id] ?? [])), {
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
