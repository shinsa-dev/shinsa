import { REMOTE_PATHS, type RemoteSession } from '@shinsa/core';
import * as React from 'react';
import { createDashboardClient } from '@/lib/remote/dashboard.ts';
import { createDeviceStore } from '@/lib/remote/devices.ts';
import { createIndexedStore } from '@/lib/remote/indexed-store.ts';
import {
  type RemoteView,
  resolveRemoteView,
  selectEnrollFragment,
  stashEnrollFragment,
} from '@/lib/remote/mode.ts';
import { type RemoteServices, RemoteServicesContext } from '@/lib/remote/services.ts';
import { EnrollPage } from './enroll.tsx';
import { FleetApp } from './fleet.tsx';
import { PairPage } from './pair.tsx';
import { RemoteLoading, RemoteShell, SignInPrompt } from './shell.tsx';
import { SlackLinkedPage } from './slack.tsx';

export function createRemoteServices(): RemoteServices {
  return {
    dashboard: createDashboardClient(),
    devices: createDeviceStore(createIndexedStore(indexedDB)),
    worker: navigator.serviceWorker,
  };
}

function resolveReturnPath(view: RemoteView) {
  if (view.kind === 'enroll') return REMOTE_PATHS.enrollPage;
  const search = new URLSearchParams(location.search);
  search.delete('sign_in_error');
  const query = search.toString();
  return query ? `${location.pathname}?${query}` : location.pathname;
}

export function RemoteRoot({ services, app }: { services: RemoteServices; app: React.ReactNode }) {
  const [view] = React.useState(() => {
    const resolved = resolveRemoteView(location);
    if (resolved.kind === 'enroll' && location.hash) {
      stashEnrollFragment(sessionStorage, location.hash, location.search);
      history.replaceState(null, '', REMOTE_PATHS.enrollPage);
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
      case 'slack':
        return <SlackLinkedPage search={location.search} />;
      case 'app':
        return null;
    }
  })();
  const shell = (inner: React.ReactNode) => (
    <RemoteShell session={session} dashboard={services.dashboard}>
      {inner}
    </RemoteShell>
  );
  if (view.kind === 'app' && session?.user && !failure)
    return (
      <RemoteServicesContext.Provider value={services}>
        <FleetApp services={services} shell={shell}>
          {app}
        </FleetApp>
      </RemoteServicesContext.Provider>
    );
  return shell(content);
}
