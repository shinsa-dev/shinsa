import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { replaceSocketOpener } from '@/lib/connection/socket.ts';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { DeviceStore } from '@/lib/remote/devices.ts';
import { RemoteLink } from '@/lib/remote/link.ts';
import { MACHINES_PATH, SERVICE_WORKER_PATH, writeChosenInstance } from '@/lib/remote/mode.ts';
import { serveRelayedRequests, startServiceWorker } from '@/lib/remote/relay.ts';
import { RemoteLoading } from './shell.tsx';

type InstanceState =
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'missing' }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string };

type Worker = Pick<
  ServiceWorkerContainer,
  'register' | 'ready' | 'controller' | 'addEventListener' | 'removeEventListener'
>;

function LeaveForMachines({ title, description }: { title: string; description: string }) {
  return (
    <main className='mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-16'>
      <PageHeading title={title} description={description} />
      <div>
        <Button
          variant='outline'
          onClick={() => {
            writeChosenInstance(sessionStorage, null);
            location.assign(MACHINES_PATH);
          }}
        >
          Show your machines
        </Button>
      </div>
    </main>
  );
}

export function InstanceApp({
  instanceId,
  dashboard,
  devices,
  worker,
  children,
}: {
  instanceId: string;
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  devices: Pick<DeviceStore, 'selectDevice' | 'removeDevice'>;
  worker: Worker;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<InstanceState>({ kind: 'starting' });
  React.useEffect(() => {
    let live = true;
    const release: (() => void)[] = [];
    void (async () => {
      const device = await devices.selectDevice(instanceId);
      if (!live) return;
      if (!device) {
        setState({ kind: 'missing' });
        return;
      }
      const link = new RemoteLink({
        instanceId,
        device,
        dashboard,
        onRefused: (error) => {
          void devices.removeDevice(instanceId);
          setState({ kind: 'refused', message: error.message });
        },
      });
      release.push(() => link.close());
      try {
        await startServiceWorker(worker, SERVICE_WORKER_PATH);
      } catch (error) {
        if (live) setState({ kind: 'failed', message: (error as Error).message });
        return;
      }
      if (!live) return;
      release.push(serveRelayedRequests(worker, (request) => link.fetch(request)));
      replaceSocketOpener(() => link.openSocket());
      release.push(() => replaceSocketOpener(null));
      setState({ kind: 'ready' });
    })();
    return () => {
      live = false;
      for (const step of release.splice(0)) step();
    };
  }, [instanceId, dashboard, devices, worker]);
  switch (state.kind) {
    case 'starting':
      return <RemoteLoading label='Connecting to your Mac' />;
    case 'missing':
      return (
        <LeaveForMachines
          title='This browser is not added to that Mac'
          description='On your Mac, open Settings, Remote access and choose Add device, then open its link here.'
        />
      );
    case 'refused':
      return (
        <LeaveForMachines
          title='Your Mac no longer accepts this browser'
          description={`${state.message} Add it again from Settings on the Mac to use it here.`}
        />
      );
    case 'failed':
      return (
        <LeaveForMachines
          title='This browser cannot reach your Mac'
          description={`${state.message} Remote access needs a browser that runs service workers.`}
        />
      );
    case 'ready':
      return children;
  }
}
