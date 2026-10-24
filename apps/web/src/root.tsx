import type { ShinsaState } from '@shinsa/core';
import { Toaster } from '@shinsa/ui/components/sonner';
import { Spinner } from '@shinsa/ui/components/spinner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import * as React from 'react';
import { SignInDialog } from '@/components/accounts/sign-in-dialog.tsx';
import { CommandMenu } from '@/components/command/menu.tsx';
import { CardsShell } from '@/components/layout/cards/shell.tsx';
import { SidebarShell } from '@/components/layout/sidebar/shell.tsx';
import { HealthBanner } from '@/components/status/health-banner.tsx';
import { useAttention } from '@/hooks/use-attention.ts';
import { useOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { connection, useConnection } from '@/lib/connection/socket.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import { type Route, replaceRoute, resolveRouteTaskId, useRoute } from '@/router.ts';
import { HomePage } from '@/routes/home.tsx';
import { OnboardingPage } from '@/routes/onboarding.tsx';
import { SettingsPage } from '@/routes/settings.tsx';
import { TaskPage } from '@/routes/task/index.tsx';
import { TasksPage } from '@/routes/tasks.tsx';

const UiPage = React.lazy(async () => ({ default: (await import('@/routes/ui/index.tsx')).UiPage }));

function Page({ state, route }: { state: ShinsaState; route: Exclude<Route, { name: 'ui' }> }) {
  const onboarding = useOnboardingStatus();
  React.useEffect(() => {
    if (route.name === 'home' && onboarding?.completed === false) replaceRoute('/onboarding');
  }, [route, onboarding]);
  switch (route.name) {
    case 'home':
      return <HomePage state={state} />;
    case 'tasks':
      return <TasksPage state={state} />;
    case 'task':
      return (
        <TaskPage
          key={resolveRouteTaskId(state, route) ?? route.reference}
          state={state}
          taskId={route.reference}
        />
      );
    case 'settings':
      return <SettingsPage state={state} />;
    case 'onboarding':
      return <OnboardingPage />;
  }
}

function AttentionSignals({ state, route }: { state: ShinsaState; route: Route }) {
  useAttention(state, resolveRouteTaskId(state, route));
  return null;
}

function Loading() {
  return (
    <div className='grid h-dvh place-items-center bg-background'>
      <Spinner size='lg' className='text-fg-2' />
    </div>
  );
}

function Workspace({ route }: { route: Exclude<Route, { name: 'ui' }> }) {
  const { state } = useConnection();
  const layout = useLayoutPreference();
  React.useEffect(() => connection.start(), []);
  if (!state) return <Loading />;
  const Shell = layout === 'cards' ? CardsShell : SidebarShell;
  return (
    <Shell state={state}>
      <HealthBanner />
      <AttentionSignals state={state} route={route} />
      <Page state={state} route={route} />
    </Shell>
  );
}

function App({ route }: { route: Exclude<Route, { name: 'ui' }> }) {
  return (
    <>
      <Workspace route={route} />
      <CommandMenu />
      <SignInDialog />
    </>
  );
}

export function Root() {
  const route = useRoute();
  return (
    <TooltipProvider>
      {route.name === 'ui' ? (
        <React.Suspense fallback={<Loading />}>
          <UiPage />
        </React.Suspense>
      ) : (
        <App route={route} />
      )}
      <Toaster />
    </TooltipProvider>
  );
}
