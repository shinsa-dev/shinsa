import type { ShinsaState } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { UsageMenu } from '@/components/accounts/usage-menu.tsx';
import { FocusMenu } from '@/components/focus/menu.tsx';
import { BrandLink } from '@/components/layout/brand-link.tsx';
import { CARDS_FRAME } from '@/components/layout/page/column.ts';
import { QueueMenu } from '@/components/queue/menu.tsx';
import { ConnectionStatus } from '@/components/status/connection-status.tsx';
import { UpdateButton } from '@/components/status/update-button.tsx';
import { useRoute, useRouteTaskId } from '@/router.ts';

export function CardsTopBar({ state }: { state: ShinsaState }) {
  const route = useRoute();
  const activeTaskId = useRouteTaskId(state);
  return (
    <header data-window-drag className='shrink-0 desktop:ps-16'>
      <div className={cn(CARDS_FRAME, 'flex h-11 items-center gap-1')}>
        <BrandLink className='me-2' />
        {route.name === 'task' && <QueueMenu state={state} activeTaskId={activeTaskId} />}
        <ConnectionStatus />
        <span className='flex-1' />
        <UpdateButton />
        {route.name !== 'onboarding' && (
          <>
            <UsageMenu state={state} />
            <div className='max-sm:hidden'>
              <FocusMenu state={state} compact />
            </div>
          </>
        )}
      </div>
    </header>
  );
}
