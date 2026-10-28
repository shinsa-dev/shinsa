import type { ShinsaState } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { UsageMenu } from '@/components/accounts/usage-menu.tsx';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { FocusMenu } from '@/components/focus/menu.tsx';
import { HomeLink } from '@/components/layout/home-link.tsx';
import { NavButton } from '@/components/layout/nav-button.tsx';
import { CARDS_FRAME } from '@/components/layout/page/column.ts';
import { QueueMenu } from '@/components/queue/menu.tsx';
import { ServicesMenu } from '@/components/services/menu.tsx';
import { ConnectionStatus } from '@/components/status/connection-status.tsx';
import { UpdateButton } from '@/components/status/update-button.tsx';
import { resolveResetKey } from '@/lib/errors.ts';
import { isQueueButtonShown } from '@/lib/queue.ts';
import { useRoute, useRouteTaskId } from '@/router.ts';

export function CardsTopBar({ state }: { state: ShinsaState }) {
  const route = useRoute();
  const activeTaskId = useRouteTaskId(state);
  const resetKey = resolveResetKey({ route, search: '' });
  return (
    <header data-window-drag className='shrink-0 select-none desktop:ps-16'>
      <div className={cn(CARDS_FRAME, 'flex h-11 items-center gap-1')}>
        <HomeLink brandClassName='me-2' />
        {route.name !== 'onboarding' && (
          <>
            <NavButton page='tasks' label='Tasks' icon='IconListBullets' activeIcon='IconListBulletsFilled' />
            <ErrorBoundary size='icon' resetKey={resetKey}>
              <ServicesMenu state={state} />
            </ErrorBoundary>
          </>
        )}
        {isQueueButtonShown(route) && (
          <ErrorBoundary size='icon' resetKey={resetKey}>
            <QueueMenu state={state} activeTaskId={activeTaskId} />
          </ErrorBoundary>
        )}
        <ErrorBoundary size='icon' resetKey={resetKey}>
          <ConnectionStatus />
        </ErrorBoundary>
        <span className='flex-1' />
        <ErrorBoundary size='icon' resetKey={resetKey}>
          <UpdateButton />
        </ErrorBoundary>
        {route.name !== 'onboarding' && (
          <>
            <NavButton
              page='settings'
              label='Settings'
              icon='IconSettingsGear4'
              activeIcon='IconSettingsGear4Filled'
              iconOnly
              className='me-0.5'
            />
            <ErrorBoundary size='icon' resetKey={resetKey}>
              <UsageMenu state={state} />
            </ErrorBoundary>
            <div className='max-sm:hidden'>
              <ErrorBoundary size='icon' resetKey={resetKey}>
                <FocusMenu state={state} compact />
              </ErrorBoundary>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
