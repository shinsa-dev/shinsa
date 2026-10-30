import * as React from 'react';
import { replaceConnection } from '@/lib/connection/socket.ts';
import { Fleet } from '@/lib/remote/fleet.ts';
import { createFleetMember, listMachineRows } from '@/lib/remote/machines.ts';
import { SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE } from '@/lib/remote/mode.ts';
import { serveRelayedRequests, startServiceWorker } from '@/lib/remote/relay.ts';
import type { RemoteServices } from '@/lib/remote/services.ts';
import { RemoteHero, RemoteLoading } from './shell.tsx';

type FleetState =
  | { kind: 'starting' }
  | { kind: 'empty'; machines: string[] }
  | { kind: 'ready' }
  | { kind: 'failed'; title: string; message: string };

function NoMachinePage({ machines }: { machines: string[] }) {
  if (machines.length === 0)
    return (
      <section className='flex flex-col items-center gap-6 pt-4'>
        <RemoteHero icon='IconMacbook' title='No Mac yet'>
          Turn on remote access on the Mac that runs Shinsa: Settings, Remote access, Turn on. It shows up
          here once you approve it.
        </RemoteHero>
      </section>
    );
  return (
    <section className='flex flex-col items-center gap-6 pt-4'>
      <RemoteHero icon='IconKey1' title='Add this browser to your Mac'>
        {`${machines.join(', ')} ${machines.length === 1 ? 'is' : 'are'} paired, but this browser has no key for ${machines.length === 1 ? 'it' : 'them'} yet. On the Mac, open Settings, Remote access, choose Add device and open its link here.`}
      </RemoteHero>
    </section>
  );
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
        const rows = await listMachineRows(services.dashboard, services.devices);
        const added = rows.flatMap((row) =>
          row.device ? [{ instance: row.instance, device: row.device }] : []
        );
        if (!live) return;
        if (added.length === 0) {
          setState({ kind: 'empty', machines: rows.map((row) => row.instance.name) });
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
                  title: 'Your Macs no longer accept this browser',
                  message: 'Add it again from Settings, Remote access on a Mac to use it here.',
                });
            },
          })
        );
        release.push(...members.map((entry) => entry.close));
        fleet = new Fleet(members.map((entry) => entry.member));
        release.push(() => fleet?.close());
        await startServiceWorker(services.worker, SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE);
        if (!live) return;
        const current = fleet;
        release.push(serveRelayedRequests(services.worker, (request) => current.fetch(request)));
        replaceConnection(current);
        release.push(() => replaceConnection(null));
        setState({ kind: 'ready' });
      } catch (error) {
        if (live)
          setState({
            kind: 'failed',
            title: 'This browser cannot reach your Macs',
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
      return shell(<RemoteLoading label='Connecting to your Macs' />);
    case 'empty':
      return shell(<NoMachinePage machines={state.machines} />);
    case 'failed':
      return shell(
        <section className='flex flex-col items-center gap-6 pt-4'>
          <RemoteHero icon='IconCircleX' tone='red' title={state.title}>
            {state.message}
          </RemoteHero>
        </section>
      );
    case 'ready':
      return children;
  }
}
