import type { ShinsaState } from '@shinsa/core';
import { Toaster } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import * as React from 'react';
import { SignInDialog } from '@/components/accounts/sign-in-dialog.tsx';
import { CommandMenu } from '@/components/command/menu.tsx';
import { CardsShell } from '@/components/layout/cards/shell.tsx';
import { SidebarShell } from '@/components/layout/sidebar/shell.tsx';
import { EngineBanner } from '@/components/status/engine-banner.tsx';
import { HealthBanner } from '@/components/status/health-banner.tsx';
import { LoadingSpinner } from '@/components/status/loading-line.tsx';
import { useAttention } from '@/hooks/use-attention.ts';
import { useIdle, useIdleValue } from '@/hooks/use-idle.ts';
import { useOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { connection, useConnection } from '@/lib/connection/socket.ts';
import {
  isHubRoute,
  KEPT_TASK_PAGES,
  type KeptView,
  listHubViews,
  resolvePageKey,
  updateKeptViews,
} from '@/lib/kept-views.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import { type Route, replaceRoute, resolveRouteTaskId, useRoute, useSearchString } from '@/router.ts';
import { HomePage } from '@/routes/home.tsx';
import { OnboardingPage } from '@/routes/onboarding.tsx';
import { SettingsPage } from '@/routes/settings.tsx';
import { TaskPage } from '@/routes/task/index.tsx';
import { Prefetch } from '@/routes/task/prefetch.tsx';
import { TasksPage } from '@/routes/tasks.tsx';

const UiPage = React.lazy(async () => ({ default: (await import('@/routes/ui/index.tsx')).UiPage }));

type PageRoute = Exclude<Route, { name: 'ui' }>;

function isSamePage(
  before: { state: ShinsaState; route: PageRoute },
  after: { state: ShinsaState; route: PageRoute }
) {
  return before.state === after.state && JSON.stringify(before.route) === JSON.stringify(after.route);
}

const PageView = React.memo(function PageContent({ state, route }: { state: ShinsaState; route: PageRoute }) {
  switch (route.name) {
    case 'home':
      return <HomePage state={state} />;
    case 'tasks':
      return <TasksPage state={state} />;
    case 'task':
      return <TaskPage state={state} taskId={route.reference} />;
    case 'settings':
      return <SettingsPage state={state} />;
    case 'onboarding':
      return <OnboardingPage />;
  }
}, isSamePage);

function Pages({ state, route }: { state: ShinsaState; route: PageRoute }) {
  const onboarding = useOnboardingStatus();
  React.useEffect(() => {
    if (route.name === 'home' && onboarding?.completed === false) replaceRoute('/onboarding');
  }, [route, onboarding]);
  const warm = useIdle();
  const settled = useIdleValue(state);
  const search = useSearchString();
  const view = React.useMemo(() => ({ route, search }), [route, search]);
  const key = resolvePageKey(view, resolveRouteTaskId(state, route));
  const hubs = React.useRef(new Map<string, typeof view>());
  const tasks = React.useRef<readonly KeptView[]>([]);
  if (isHubRoute(route)) hubs.current.set(route.name, view);
  if (route.name === 'task') tasks.current = updateKeptViews(tasks.current, key, view, KEPT_TASK_PAGES);
  const pages = [...listHubViews(hubs.current, warm), ...tasks.current];
  return (
    <>
      {pages.map((page) => {
        const shown = page.key === key;
        return (
          <React.Activity key={page.key} mode={shown ? 'visible' : 'hidden'}>
            <PageView state={shown ? state : settled} route={page.view.route as PageRoute} />
          </React.Activity>
        );
      })}
      {route.name === 'onboarding' && <OnboardingPage />}
    </>
  );
}

function AttentionSignals({ state, route }: { state: ShinsaState; route: Route }) {
  useAttention(state, resolveRouteTaskId(state, route));
  return null;
}

function Loading() {
  return (
    <div className='grid h-dvh place-items-center bg-background'>
      <LoadingSpinner label='Starting Shinsa' />
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
      <EngineBanner />
      <AttentionSignals state={state} route={route} />
      <Prefetch state={state} />
      <Pages state={state} route={route} />
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
