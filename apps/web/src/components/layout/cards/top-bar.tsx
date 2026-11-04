import type { ShinsaState } from '@shinsa/core';
import { useMediaQuery } from '@shinsa/ui/hooks/use-media-query';
import { cn } from '@shinsa/ui/lib/utils';
import { UsageMenu } from '@/components/accounts/usage-menu.tsx';
import { WhatsNewButton } from '@/components/changelog/dialog.tsx';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { FeedbackButton } from '@/components/feedback/button.tsx';
import { FocusMenu } from '@/components/focus/menu.tsx';
import { HomeLink } from '@/components/layout/home-link.tsx';
import { NavButton } from '@/components/layout/nav-button.tsx';
import { CARDS_FRAME } from '@/components/layout/page/column.ts';
import {
  CompactBar,
  PHONE_QUERY,
  SAFE_AREA_SIDES,
  SAFE_AREA_TOP,
} from '@/components/layout/sidebar/compact-bar.tsx';
import { QueueMenu } from '@/components/queue/menu.tsx';
import { ServicesMenu } from '@/components/services/menu.tsx';
import { ConnectionStatus } from '@/components/status/connection-status.tsx';
import { UpdateButton } from '@/components/status/update-button.tsx';
import { resolveResetKey } from '@/lib/errors.ts';
import { isQueueButtonShown } from '@/lib/queue.ts';
import { useRoute, useRouteTaskId } from '@/router.ts';

export function CardsTopBar({ state, onMore }: { state: ShinsaState; onMore: () => void }) {
  const route = useRoute();
  const activeTaskId = useRouteTaskId(state);
  const resetKey = resolveResetKey({ route, search: '' });
  const phone = useMediaQuery(PHONE_QUERY);
  return (
    <header
      data-window-drag
      className={cn('shrink-0 select-none desktop:ps-16', SAFE_AREA_TOP, SAFE_AREA_SIDES)}
    >
      {phone ? (
        <CompactBar state={state} onMore={onMore} className={CARDS_FRAME} />
      ) : (
        <div className={cn(CARDS_FRAME, 'flex h-11 items-center gap-1')}>
          <HomeLink brandClassName='me-2' />
          {route.name !== 'onboarding' && (
            <>
              <NavButton
                page='tasks'
                label='Tasks'
                icon='IconListBullets'
                activeIcon='IconListBulletsFilled'
              />
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
            <WhatsNewButton />
          </ErrorBoundary>
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
              />
              <ErrorBoundary size='icon' resetKey={resetKey}>
                <FeedbackButton state={state} className='me-0.5' />
              </ErrorBoundary>
              <ErrorBoundary size='icon' resetKey={resetKey}>
                <UsageMenu state={state} />
              </ErrorBoundary>
              <ErrorBoundary size='icon' resetKey={resetKey}>
                <FocusMenu state={state} compact />
              </ErrorBoundary>
            </>
          )}
        </div>
      )}
    </header>
  );
}
