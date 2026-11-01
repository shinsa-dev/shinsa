import { describeList } from '@shinsa/core';
import * as React from 'react';
import { replaceConnection } from '@/lib/connection/socket.ts';
import { requestWaitingAnswer } from '@/lib/remote/enroll.ts';
import { Fleet } from '@/lib/remote/fleet.ts';
import { createFleetMember, listMachineRows, type MachineRow } from '@/lib/remote/machines.ts';
import {
  describeOutdatedMachine,
  MACHINE_ICON,
  SERVICE_WORKER_PATH,
  SERVICE_WORKER_SCOPE,
} from '@/lib/remote/mode.ts';
import { serveRelayedRequests, startServiceWorker } from '@/lib/remote/relay.ts';
import type { RemoteServices } from '@/lib/remote/services.ts';
import { RemoteBenefits, RemoteCheckAgain, RemoteHero, RemoteLoading, RemoteSteps } from './shell.tsx';

type FleetState =
  | { kind: 'starting' }
  | { kind: 'empty'; machines: string[] }
  | { kind: 'waiting'; machines: string[] }
  | { kind: 'ready'; fleet: Fleet }
  | { kind: 'failed'; title: string; message: string };

const PAIR_STEPS = [
  'Open Shinsa on the machine that runs it.',
  'Go to Settings, Remote access and choose Turn on.',
  'Sign in with GitHub and approve the code it shows. The machine shows up here.',
];

function listAddDeviceSteps(machines: string[]) {
  return [
    `On ${describeList(machines)}, open Settings > Remote access and choose Invite link.`,
    'Scan the QR code with this device, or open the link here, and ask for access.',
    'Accept the request on the machine.',
  ];
}

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

async function settleWaitingRow(row: MachineRow, services: RemoteServices): Promise<MachineRow> {
  if (!row.device?.waiting) return row;
  const answer = await requestWaitingAnswer(row.device, {
    dashboard: services.dashboard,
    devices: services.devices,
    openSocket: (url) => new WebSocket(url),
  });
  if (answer === 'waiting') return row;
  if (answer === 'declined') return { ...row, device: null };
  return { ...row, device: await services.devices.selectDevice(row.instance.id) };
}

function settleWaitingRows(rows: MachineRow[], services: RemoteServices) {
  return Promise.all(rows.map((row) => settleWaitingRow(row, services)));
}

function NoMachinePage({ machines }: { machines: string[] }) {
  if (machines.length === 0)
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon={MACHINE_ICON} title='No machine yet'>
          Turn on remote access on the machine that runs Shinsa. It shows up here once you approve it.
        </RemoteHero>
        <RemoteSteps title='Pair a machine' steps={PAIR_STEPS} />
        <RemoteBenefits />
        <RemoteCheckAgain />
      </section>
    );
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconKey1' title='Add this device to your machine'>
        {`${describeList(machines)} ${machines.length === 1 ? 'is' : 'are'} paired, but this device has no key for ${machines.length === 1 ? 'it' : 'them'} yet.`}
      </RemoteHero>
      <RemoteSteps title='Add this device' steps={listAddDeviceSteps(machines)} />
      <RemoteBenefits />
      <RemoteCheckAgain />
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

export function FleetApp({
  services,
  shell,
  children,
}: {
  services: RemoteServices;
  shell: (content: React.ReactNode) => React.ReactNode;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<FleetState>({ kind: 'starting' });
  React.useEffect(() => {
    let live = true;
    const release: (() => void)[] = [];
    void (async () => {
      try {
        const rows = await settleWaitingRows(
          await listMachineRows(services.dashboard, services.devices),
          services
        );
        const added = rows.flatMap((row) =>
          row.device && !row.device.waiting ? [{ instance: row.instance, device: row.device }] : []
        );
        const listed = new Set(rows.map((row) => row.instance.id));
        const waiting = [
          ...rows.flatMap((row) => (row.device?.waiting ? [row.instance.name] : [])),
          ...(await services.devices.listWaitingDevices()).flatMap((device) =>
            listed.has(device.instanceId) || !device.waiting ? [] : [device.waiting.machineName]
          ),
        ];
        if (!live) return;
        if (added.length === 0) {
          setState(
            waiting.length > 0
              ? { kind: 'waiting', machines: waiting }
              : { kind: 'empty', machines: rows.map((row) => row.instance.name) }
          );
          return;
        }
        let fleet: Fleet | null = null;
        const members = added.map(({ instance, device }) =>
          createFleetMember(instance, device, {
            dashboard: services.dashboard,
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
        release.push(...members.map((entry) => entry.close));
        fleet = new Fleet(
          members.map((entry) => entry.member),
          rows.flatMap((row) =>
            row.device && !row.device.waiting ? [] : [{ id: row.instance.id, name: row.instance.name }]
          )
        );
        release.push(() => fleet?.close());
        await startServiceWorker(services.worker, SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE);
        if (!live) return;
        const current = fleet;
        release.push(serveRelayedRequests(services.worker, (request) => current.fetch(request)));
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
  }, [services]);
  switch (state.kind) {
    case 'starting':
      return shell(<RemoteLoading label='Connecting to your machines' />);
    case 'empty':
      return shell(<NoMachinePage machines={state.machines} />);
    case 'waiting':
      return shell(<WaitingPage machines={state.machines} />);
    case 'failed':
      return shell(
        <section className='flex flex-col items-center gap-6 pt-4'>
          <RemoteHero icon='IconCircleX' tone='red' title={state.title}>
            {state.message}
          </RemoteHero>
          <RemoteBenefits />
          <RemoteCheckAgain label='Try again' />
        </section>
      );
    case 'ready':
      return (
        <FleetReady fleet={state.fleet} shell={shell}>
          {children}
        </FleetReady>
      );
  }
}
