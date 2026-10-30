import type { RemoteSession } from '@shinsa/core';
import * as React from 'react';
import { createDashboardClient, type DashboardClient } from '@/lib/remote/dashboard.ts';
import { createDeviceStore, type DeviceStore } from '@/lib/remote/devices.ts';
import { createIndexedStore } from '@/lib/remote/indexed-store.ts';
import {
  type RemoteView,
  resolveRemoteView,
  selectEnrollFragment,
  stashEnrollFragment,
} from '@/lib/remote/mode.ts';
import { EnrollPage } from './enroll.tsx';
import { InstanceApp } from './instance.tsx';
import { MachinesPage } from './machines.tsx';
import { PairPage } from './pair.tsx';
import { RemoteLoading, RemoteShell, SignInPrompt } from './shell.tsx';

export interface RemoteServices {
  dashboard: DashboardClient;
  devices: DeviceStore;
  worker: ServiceWorkerContainer;
}

export function createRemoteServices(): RemoteServices {
  return {
    dashboard: createDashboardClient(),
    devices: createDeviceStore(createIndexedStore(indexedDB)),
    worker: navigator.serviceWorker,
  };
}

function resolveReturnPath(view: RemoteView) {
  if (view.kind === 'enroll') return '/enroll';
  return `${location.pathname}${location.search}`;
}

export function RemoteRoot({ services, app }: { services: RemoteServices; app: React.ReactNode }) {
  const [view] = React.useState(() => {
    const resolved = resolveRemoteView(location, sessionStorage);
    if (resolved.kind === 'enroll' && location.hash) {
      stashEnrollFragment(sessionStorage, location.hash);
      history.replaceState(null, '', '/enroll');
    }
    return resolved;
  });
  const [session, setSession] = React.useState<RemoteSession | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  React.useEffect(() => {
    services.dashboard
      .readSession()
      .then(setSession, (error: unknown) => setFailure((error as Error).message));
  }, [services]);
  const signInError = new URLSearchParams(location.search).get('sign_in_error');
  const content = (() => {
    if (failure)
      return (
        <p role='alert' className='text-destructive text-xs'>
          {failure}
        </p>
      );
    if (!session) return <RemoteLoading label='Checking your sign-in' />;
    if (!session.user) return <SignInPrompt returnPath={resolveReturnPath(view)} error={signInError} />;
    switch (view.kind) {
      case 'pair':
        return <PairPage claimCode={view.claimCode} dashboard={services.dashboard} />;
      case 'enroll':
        return (
          <EnrollPage
            link={selectEnrollFragment(sessionStorage, '')}
            dashboard={services.dashboard}
            devices={services.devices}
          />
        );
      case 'machines':
        return <MachinesPage dashboard={services.dashboard} devices={services.devices} />;
      case 'instance':
        return null;
    }
  })();
  if (view.kind === 'instance' && session?.user)
    return (
      <InstanceApp
        instanceId={view.instanceId}
        dashboard={services.dashboard}
        devices={services.devices}
        worker={services.worker}
      >
        {app}
      </InstanceApp>
    );
  return (
    <RemoteShell session={session} dashboard={services.dashboard}>
      {content}
    </RemoteShell>
  );
}
