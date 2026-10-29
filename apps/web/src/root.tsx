import type { ShinsaState } from '@shinsa/core';
import { Toaster } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { useSelectAllScope } from '@shinsa/ui/hooks/use-select-all-scope';
import * as React from 'react';
import { SignInDialog } from '@/components/accounts/sign-in-dialog.tsx';
import { CommandMenu } from '@/components/command/menu.tsx';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { AppFrame } from '@/components/layout/frame.tsx';
import { OnboardingShell } from '@/components/onboarding/shell.tsx';
import { EngineBanner } from '@/components/status/engine-banner.tsx';
import { HealthBanner } from '@/components/status/health-banner.tsx';
import { LoadingSpinner } from '@/components/status/loading-line.tsx';
import { ForkDialog } from '@/components/task/fork-dialog.tsx';
import { useAttention } from '@/hooks/use-attention.ts';
import { useIdle, useIdleValue } from '@/hooks/use-idle.ts';
import { useCommandMenuOpen, writeCommandMenuOpen } from '@/lib/command/registry.ts';
import { useOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { connection, useConnection } from '@/lib/connection/socket.ts';
import { ERROR_COPY, recordCommandMenuError, resolveResetKey } from '@/lib/errors.ts';
import {
  isHubRoute,
  KEPT_TASK_PAGES,
  type KeptView,
  listHubViews,
  resolvePageKey,
  updateKeptViews,
} from '@/lib/kept-views.ts';
import { resolveOnboardingRedirect } from '@/lib/onboarding.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import { type Route, replaceRoute, resolveRouteTaskId, useRoute, useSearchString } from '@/router.ts';
import { AutomationPage } from '@/routes/automation.tsx';
import { HomePage } from '@/routes/home.tsx';
import { OnboardingPage } from '@/routes/onboarding.tsx';
import { SettingsPage } from '@/routes/settings.tsx';
import { TaskPage } from '@/routes/task/index.tsx';
import { Prefetch } from '@/routes/task/prefetch.tsx';
import { TasksPage } from '@/routes/tasks.tsx';
import { TerminalPage } from '@/routes/terminal.tsx';

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
    case 'automation':
      return <AutomationPage state={state} scheduleId={route.scheduleId} />;
    case 'settings':
      return <SettingsPage state={state} />;
    case 'terminal':
      return <TerminalPage state={state} />;
    case 'onboarding':
      return <OnboardingPage />;
  }
}, isSamePage);

function Pages({ state, route }: { state: ShinsaState; route: PageRoute }) {
  const warm = useIdle();
  const settled = useIdleValue(state);
  const search = useSearchString();
  const view = React.useMemo(() => ({ route, search }), [route, search]);
  const key = resolvePageKey(view, resolveRouteTaskId(state, route));
  const hubs = React.useRef(new Map<string, typeof view>());
  const tasks = React.useRef<readonly KeptView[]>([]);
  const visit = React.useRef({ key, count: 0 });
  if (visit.current.key !== key) visit.current = { key, count: visit.current.count + 1 };
  if (isHubRoute(route)) hubs.current.set(route.name, view);
  if (route.name === 'task') tasks.current = updateKeptViews(tasks.current, key, view, KEPT_TASK_PAGES);
  const pages = [
    ...listHubViews(hubs.current, warm),
    ...tasks.current,
    ...(route.name === 'automation' ? [{ key, view, shownAt: 0 }] : []),
  ];
  return (
    <>
      {pages.map((page) => {
        const shown = page.key === key;
        return (
          <React.Activity key={page.key} mode={shown ? 'visible' : 'hidden'}>
            <ErrorBoundary
              size='page'
              resetKey={shown ? resolveResetKey(page.view, visit.current.count) : 'hidden'}
            >
              <PageView state={shown ? state : settled} route={page.view.route as PageRoute} />
            </ErrorBoundary>
          </React.Activity>
        );
      })}
      {route.name === 'onboarding' && (
        <ErrorBoundary size='page' resetKey={resolveResetKey(view, visit.current.count)}>
          <OnboardingPage />
        </ErrorBoundary>
      )}
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

function Workspace({ route }: { route: PageRoute }) {
  const { state } = useConnection();
  const layout = useLayoutPreference();
  const search = useSearchString();
  React.useEffect(() => connection.start(), []);
  if (!state) return <Loading />;
  const viewKey = resolveResetKey({ route, search });
  const content = (
    <>
      <ErrorBoundary size='silent' resetKey={viewKey}>
        <HealthBanner />
        <EngineBanner />
      </ErrorBoundary>
      <ErrorBoundary size='silent' resetKey={viewKey}>
        <AttentionSignals state={state} route={route} />
        <Prefetch state={state} />
      </ErrorBoundary>
      <Pages state={state} route={route} />
    </>
  );
  if (route.name === 'onboarding') return <OnboardingShell>{content}</OnboardingShell>;
  return (
    <AppFrame layout={layout} state={state}>
      {content}
    </AppFrame>
  );
}

function GuardedCommandMenu({ route }: { route: PageRoute }) {
  const open = useCommandMenuOpen();
  return (
    <ErrorBoundary
      size='silent'
      resetKey={`${open} ${resolveResetKey({ route, search: '' })}`}
      onError={recordCommandMenuError}
    >
      <CommandMenu />
    </ErrorBoundary>
  );
}

function App({ route }: { route: PageRoute }) {
  const onboarding = useOnboardingStatus();
  const redirect = resolveOnboardingRedirect(route, onboarding);
  React.useEffect(() => {
    if (redirect) replaceRoute(redirect);
  }, [redirect]);
  React.useEffect(() => {
    if (route.name === 'onboarding') writeCommandMenuOpen(false);
  }, [route.name]);
  return (
    <>
      <Workspace route={route} />
      {route.name !== 'onboarding' && redirect === null && <GuardedCommandMenu route={route} />}
      <ErrorBoundary size='silent'>
        <SignInDialog />
      </ErrorBoundary>
      <ErrorBoundary size='silent'>
        <ForkDialog />
      </ErrorBoundary>
    </>
  );
}

export function Root() {
  const route = useRoute();
  const search = useSearchString();
  useSelectAllScope();
  return (
    <TooltipProvider>
      <ErrorBoundary
        size='page'
        resetKey={resolveResetKey({ route, search })}
        title={ERROR_COPY.app}
        description={ERROR_COPY.appHint}
        className='flex h-dvh flex-col bg-background'
      >
        {route.name === 'ui' ? (
          <React.Suspense fallback={<Loading />}>
            <UiPage />
          </React.Suspense>
        ) : (
          <App route={route} />
        )}
      </ErrorBoundary>
      <Toaster />
    </TooltipProvider>
  );
}
