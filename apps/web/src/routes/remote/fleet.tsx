import * as React from 'react';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { SettingsCard } from '@/components/settings/group.tsx';
import { MachineList, useMachineRows } from '@/components/settings/machines.tsx';
import { replaceConnection } from '@/lib/connection/socket.ts';
import { Fleet } from '@/lib/remote/fleet.ts';
import { createFleetMember, listMachineRows } from '@/lib/remote/machines.ts';
import { SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE } from '@/lib/remote/mode.ts';
import { serveRelayedRequests, startServiceWorker } from '@/lib/remote/relay.ts';
import type { RemoteServices } from '@/lib/remote/services.ts';
import { RemoteLoading } from './shell.tsx';

type FleetState =
  | { kind: 'starting' }
  | { kind: 'empty' }
  | { kind: 'ready' }
  | { kind: 'failed'; title: string; message: string };

function NoMachinePage() {
  const { rows, failure, remove } = useMachineRows();
  return (
    <section className='flex flex-col gap-4'>
      <PageHeading
        title='Add this browser to a Mac'
        description='Your dashboard shows the tasks of every Mac this browser is added to. On a Mac, open Settings, Remote access, choose Add device and open its link here.'
      />
      {failure && (
        <p role='alert' className='text-destructive text-xs'>
          {failure}
        </p>
      )}
      {rows ? (
        <SettingsCard>
          <MachineList rows={rows} onRemove={remove} />
        </SettingsCard>
      ) : (
        <RemoteLoading label='Reading your Macs' />
      )}
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
          setState({ kind: 'empty' });
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
      return shell(<NoMachinePage />);
    case 'failed':
      return shell(<PageHeading title={state.title} description={state.message} />);
    case 'ready':
      return children;
  }
}
