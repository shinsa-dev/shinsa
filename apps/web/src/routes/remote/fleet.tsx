import { describeList, type RemoteUser } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { SettingsCard } from '@/components/settings/group.tsx';
import { replaceConnection } from '@/lib/connection/socket.ts';
import { applyDesktopMachine, selectDesktopSource } from '@/lib/desktop.ts';
import { serveNotificationOpens } from '@/lib/notifications/worker.ts';
import { resolveDeviceName } from '@/lib/remote/device-name.ts';
import { listSettledMachineRows } from '@/lib/remote/enroll.ts';
import { Fleet } from '@/lib/remote/fleet.ts';
import { createFleetMember, type MachineRow } from '@/lib/remote/machines.ts';
import {
  describeOutdatedMachine,
  MACHINE_ICON,
  SERVICE_WORKER_PATH,
  SERVICE_WORKER_SCOPE,
  type RemotePoint,
} from '@/lib/remote/mode.ts';
import { serveRelayedRequests, startServiceWorker } from '@/lib/remote/relay.ts';
import type { RemoteServices } from '@/lib/remote/services.ts';
import { listAddDeviceSteps, PAIR_STEPS } from '@/lib/remote/setup-steps.ts';
import {
  describeMachineChoice,
  describeMissingMachine,
  isInScope,
  listScopedRows,
  type MachineScope,
  resolveMachineScope,
  resolveMissingMachine,
  resolvePinnedMachine,
  VIEWER_COPY,
} from '@/lib/remote/viewer-mode.ts';
import { ViewerContext } from '@/lib/remote/viewer.ts';
import { forkApp, runApp } from '@/lib/runtime/app.ts';
import { admitTeamMachines } from '@/lib/teams/admit.ts';
import { HostedTeamFeeds } from '@/lib/teams/feeds.ts';
import { syncOwnTeamKeys } from '@/lib/teams/own-keys.ts';
import { resolveTeammateScopes } from '@/lib/teams/scopes.ts';
import { navigate } from '@/router.ts';
import {
  InviteLinkForm,
  RemoteBenefits,
  RemoteCheckAgain,
  RemoteHero,
  RemoteLoading,
  RemoteSteps,
  UseLocalEngineButton,
} from './shell.tsx';

type FleetState =
  | { kind: 'starting' }
  | { kind: 'empty'; machines: string[]; teams: string[] }
  | { kind: 'waiting'; machines: string[] }
  | { kind: 'choose'; rows: MachineRow[]; missing: string | null }
  | { kind: 'ready'; fleet: Fleet }
  | { kind: 'failed'; title: string; message: string };

function WaitingPage({ machines }: { machines: string[] }) {
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconKey1' title='Waiting for an answer'>
        {`This device asked to reach ${describeList(machines)}. It opens here once the request is accepted in Settings > Remote access on the machine.`}
      </RemoteHero>
      <RemoteBenefits />
      <RemoteCheckAgain />
    </section>
  );
}

const TEAM_REACH_POINTS: RemotePoint[] = [
  {
    icon: 'IconEyeOpen',
    title: 'Your team’s work, live',
    detail: 'Every task in the projects your teammates share, on a machine shared with the team.',
  },
  {
    icon: MACHINE_ICON,
    title: 'Run tasks on a shared machine',
    detail: 'What you start there is yours and runs as you.',
  },
  {
    icon: 'IconShieldCheck',
    title: 'Encrypted end to end',
    detail: 'This device gets its own key from the shared machine. app.shinsa.dev cannot read your work.',
  },
];

function TeamReachPage({ teams }: { teams: string[] }) {
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconUserAdd' title='Reached through your team'>
        {`You have no machine of your own, so you reach ${describeList(teams)} through a machine a teammate shares with it. It opens here once one is shared.`}
      </RemoteHero>
      <RemoteBenefits points={TEAM_REACH_POINTS} />
      <RemoteCheckAgain />
    </section>
  );
}

function ChooseMachinePage({ rows, missing }: { rows: MachineRow[]; missing: string | null }) {
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon={MACHINE_ICON} tone={missing ? 'amber' : 'neutral'} title={VIEWER_COPY.chooseTitle}>
        {missing ? describeMissingMachine(missing) : VIEWER_COPY.chooseBody}
      </RemoteHero>
      <SettingsCard className='w-full'>
        {rows.length === 0 && <p className='px-2.5 py-2 text-xs text-fg-2'>{VIEWER_COPY.noMachines}</p>}
        {rows.map((row) => (
          <div key={row.instance.id} className='flex items-center gap-3 px-2.5 py-1.5'>
            <Icon name={MACHINE_ICON} size='sm' className='shrink-0 text-fg-2' />
            <div className='flex min-w-0 flex-1 flex-col'>
              <span className='truncate text-xs text-fg-4'>{row.label}</span>
              <span className='truncate text-2xs text-fg-2'>{describeMachineChoice(row)}</span>
            </div>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => applyDesktopMachine(resolvePinnedMachine(row))}
            >
              {VIEWER_COPY.choose}
            </Button>
          </div>
        ))}
      </SettingsCard>
      <div className='flex w-full flex-col gap-2'>
        <RemoteCheckAgain />
        <UseLocalEngineButton />
      </div>
    </section>
  );
}

function InAppActions() {
  if (!selectDesktopSource()) return null;
  return <UseLocalEngineButton />;
}

export function NoMachinePage({ machines, teams }: { machines: string[]; teams: string[] }) {
  const inApp = selectDesktopSource() !== null;
  if (machines.length === 0 && teams.length > 0) return <TeamReachPage teams={teams} />;
  if (machines.length === 0)
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon={MACHINE_ICON} title='No machine yet'>
          Turn on remote access on the machine that runs Shinsa. It shows up here once you approve it.
        </RemoteHero>
        <RemoteSteps title='Pair a machine' steps={PAIR_STEPS} />
        <RemoteBenefits />
        <RemoteCheckAgain />
        <InAppActions />
      </section>
    );
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconKey1' title='Add this device to your machine'>
        {`${describeList(machines)} ${machines.length === 1 ? 'is' : 'are'} paired, but this device has no key for ${machines.length === 1 ? 'it' : 'them'} yet.`}
      </RemoteHero>
      <RemoteSteps title='Add this device' steps={listAddDeviceSteps(machines, inApp)} />
      {inApp && <InviteLinkForm />}
      <RemoteBenefits />
      <RemoteCheckAgain />
      <InAppActions />
    </section>
  );
}

function OutdatedPage({ machines }: { machines: string[] }) {
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero
        icon='IconArrowRotateClockwise'
        tone='amber'
        title={describeOutdatedMachine(describeList(machines))}
      >
        {`${describeList(machines)} ${machines.length === 1 ? 'runs' : 'run'} a version of Shinsa this page cannot work with. Update Shinsa there, then try again.`}
      </RemoteHero>
      <RemoteCheckAgain label='Try again' />
    </section>
  );
}

function FleetReady({
  fleet,
  shell,
  children,
}: {
  fleet: Fleet;
  shell: (content: React.ReactNode) => React.ReactNode;
  children: React.ReactNode;
}) {
  const outdated = React.useSyncExternalStore(fleet.subscribe, () => fleet.isEveryMachineOutdated());
  if (!outdated) return children;
  return shell(<OutdatedPage machines={fleet.members.map((member) => member.name)} />);
}

async function listFleetTeams(services: RemoteServices) {
  try {
    return await services.dashboard.listTeams();
  } catch {
    return [];
  }
}

async function listFleetRows(services: RemoteServices, scope: MachineScope) {
  const settled = await runApp(
    listSettledMachineRows({
      dashboard: services.dashboard,
      devices: services.devices,
      openSocket: (url) => new WebSocket(url),
    })
  );
  await syncOwnTeamKeys(settled, { dashboard: services.dashboard, teamKeys: services.teamKeys });
  const admitted = await admitTeamMachines(settled, {
    dashboard: services.dashboard,
    devices: services.devices,
    selectTeamKey: services.teamKeys.selectTeamKey,
    name: resolveDeviceName(navigator.userAgent, navigator.maxTouchPoints > 1, null),
  });
  const teams = await listFleetTeams(services);
  const missing = resolveMissingMachine(scope, admitted);
  if (scope.kind === 'choose' || missing) return { kind: 'choose' as const, rows: admitted, missing };
  return {
    kind: 'rows' as const,
    rows: listScopedRows(admitted, scope),
    teams,
  };
}

async function listWaitingMachines(rows: MachineRow[], services: RemoteServices, scope: MachineScope) {
  const listed = new Set(rows.map((row) => row.instance.id));
  return [
    ...rows.flatMap((row) => (row.device?.waiting ? [row.instance.name] : [])),
    ...(await services.devices.listWaitingDevices()).flatMap((device) =>
      listed.has(device.instanceId) || !device.waiting || !isInScope(scope, device.instanceId)
        ? []
        : [device.waiting.machineName]
    ),
  ];
}

function resolveIdleState(
  rows: MachineRow[],
  waiting: string[],
  teams: readonly { name: string }[]
): FleetState {
  if (waiting.length > 0) return { kind: 'waiting', machines: waiting };
  return {
    kind: 'empty',
    machines: rows.flatMap((row) => (row.instance.role === 'teammate' ? [] : [row.instance.name])),
    teams: teams.map((team) => team.name),
  };
}

function createHostedTeams(services: RemoteServices, scope: MachineScope) {
  if (scope.kind !== 'every') return null;
  return new HostedTeamFeeds({
    listTeams: services.dashboard.listTeams,
    selectTeamKey: services.teamKeys.selectTeamKey,
  });
}

export function FleetApp({
  services,
  viewer,
  shell,
  children,
}: {
  services: RemoteServices;
  viewer: RemoteUser;
  shell: (content: React.ReactNode) => React.ReactNode;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<FleetState>({ kind: 'starting' });
  const [scope] = React.useState<MachineScope>(() => resolveMachineScope(selectDesktopSource()));
  React.useEffect(() => {
    let live = true;
    const release: (() => void)[] = [];
    void (async () => {
      try {
        const listed = await listFleetRows(services, scope);
        if (listed.kind === 'choose') {
          if (live) setState(listed);
          return;
        }
        const { rows, teams } = listed;
        const added = rows.flatMap((row) =>
          row.device && !row.device.waiting ? [{ instance: row.instance, device: row.device }] : []
        );
        const waiting = await listWaitingMachines(rows, services, scope);
        if (!live) return;
        if (added.length === 0) {
          setState(resolveIdleState(rows, waiting, teams));
          return;
        }
        let fleet: Fleet | null = null;
        const members = added.map(({ instance, device }) =>
          createFleetMember(instance, device, {
            dashboard: services.dashboard,
            viewerId: viewer.id,
            teammateScopes: resolveTeammateScopes(teams, instance.id, viewer.id),
            onRemoved: (instanceId) => {
              void services.devices.removeDevice(instanceId);
              fleet?.removeMachine(instanceId);
            },
            onRefused: (instanceId) => {
              void services.devices.removeDevice(instanceId);
              fleet?.removeMember(instanceId);
              if (fleet?.members.length === 0)
                setState({
                  kind: 'failed',
                  title: 'Your machines no longer accept this device',
                  message: 'Ask for access again with a machine’s invite link to use it here.',
                });
            },
          })
        );
        const hostedTeams = createHostedTeams(services, scope);
        release.push(() => hostedTeams?.stop());
        fleet = new Fleet(
          members,
          rows.flatMap((row) =>
            (row.device && !row.device.waiting) || row.instance.role === 'teammate'
              ? []
              : [{ id: row.instance.id, name: row.instance.name }]
          ),
          hostedTeams
        );
        void hostedTeams?.start();
        release.push(() => fleet?.close());
        await runApp(startServiceWorker(services.worker, SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE));
        if (!live) return;
        const current = fleet;
        const serving = forkApp(serveRelayedRequests(services.worker, (request) => current.fetch(request)));
        release.push(() => serving.interruptUnsafe());
        release.push(serveNotificationOpens(services.worker, navigate));
        replaceConnection(current);
        release.push(() => replaceConnection(null));
        setState({ kind: 'ready', fleet: current });
      } catch (error) {
        if (live)
          setState({
            kind: 'failed',
            title: 'This device cannot reach your machines',
            message: `${(error as Error).message} Remote access needs a browser that runs service workers.`,
          });
      }
    })();
    return () => {
      live = false;
      for (const step of release.splice(0).reverse()) step();
    };
  }, [services, viewer, scope]);
  switch (state.kind) {
    case 'starting':
      return shell(<RemoteLoading label='Connecting to your machines' />);
    case 'empty':
      return shell(<NoMachinePage machines={state.machines} teams={state.teams} />);
    case 'waiting':
      return shell(<WaitingPage machines={state.machines} />);
    case 'choose':
      return shell(<ChooseMachinePage rows={state.rows} missing={state.missing} />);
    case 'failed':
      return shell(
        <section className='flex flex-col items-center gap-6 pt-4'>
          <RemoteHero icon='IconCircleX' tone='red' title={state.title}>
            {state.message}
          </RemoteHero>
          <RemoteBenefits />
          <RemoteCheckAgain label='Try again' />
          <InAppActions />
        </section>
      );
    case 'ready':
      return (
        <ViewerContext value={viewer}>
          <FleetReady fleet={state.fleet} shell={shell}>
            {children}
          </FleetReady>
        </ViewerContext>
      );
  }
}
