import type { ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import { CommandMenuButton } from '@/components/command/menu.tsx';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { FeedbackButton } from '@/components/feedback/button.tsx';
import { HomeLink } from '@/components/layout/home-link.tsx';
import { NavButton } from '@/components/layout/nav-button.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { QueueMenu } from '@/components/queue/menu.tsx';
import { ConnectionStatus } from '@/components/status/connection-status.tsx';
import { resolveResetKey } from '@/lib/errors.ts';
import { isQueueButtonShown } from '@/lib/queue.ts';
import { useRoute, useRouteTaskId } from '@/router.ts';

export const PHONE_QUERY = '(max-width: 639.98px)';

export const SAFE_AREA_TOP = 'pt-[env(safe-area-inset-top)]';

export const SAFE_AREA_BOTTOM = 'pb-[env(safe-area-inset-bottom)]';

export const SAFE_AREA_SIDES = 'ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)]';

export function CompactBar({
  state,
  onMore,
  className,
}: {
  state: ShinsaState;
  onMore: () => void;
  className?: string;
}) {
  const route = useRoute();
  const activeTaskId = useRouteTaskId(state);
  const resetKey = resolveResetKey({ route, search: '' });
  const setup = route.name === 'onboarding';
  return (
    <div className={cn('flex h-11 items-center gap-1', className)}>
      <HomeLink brandClassName='me-1' />
      {!setup && (
        <NavButton
          page='tasks'
          label='Tasks'
          icon='IconListBullets'
          activeIcon='IconListBulletsFilled'
          iconOnly
        />
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
      {!setup && (
        <>
          <ErrorBoundary size='icon' resetKey={resetKey}>
            <FeedbackButton state={state} variant='compact' />
          </ErrorBoundary>
          <CommandMenuButton />
          <Hint label='More'>
            <Button
              variant='secondary'
              size='icon-sm'
              icon='IconDotGrid1x3Horizontal'
              aria-label='More'
              onClick={onMore}
            />
          </Hint>
        </>
      )}
    </div>
  );
}
