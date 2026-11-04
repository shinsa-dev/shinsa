import type { ShinsaState } from '@shinsa/core';
import { Sheet, SheetContent, SheetTitle } from '@shinsa/ui/components/sheet';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ChangelogDialog } from '@/components/changelog/dialog.tsx';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { FeedbackDialog } from '@/components/feedback/dialog.tsx';
import type { LayoutPreference } from '@/lib/preferences/layout.ts';
import { useRailWidth } from '@/lib/preferences/rail-width.ts';
import { useRoute } from '@/router.ts';
import { CardsTopBar } from './cards/top-bar.tsx';
import { CompactBar, SAFE_AREA_BOTTOM, SAFE_AREA_SIDES, SAFE_AREA_TOP } from './sidebar/compact-bar.tsx';
import { Rail } from './sidebar/rail.tsx';
import { ResizeHandle } from './sidebar/resize-handle.tsx';

function SidebarRail({ state }: { state: ShinsaState }) {
  const rail = useRailWidth();
  return (
    <aside style={{ width: rail.width }} className='relative hidden shrink-0 border-r border-border md:flex'>
      <Rail state={state} />
      <ResizeHandle onPointerDown={rail.startResize} onDoubleClick={rail.resetWidth} />
    </aside>
  );
}

export function AppFrame({
  layout,
  state,
  children,
}: {
  layout: LayoutPreference;
  state: ShinsaState;
  children: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const route = useRoute();
  React.useEffect(() => setMoreOpen(false), [route]);
  const sidebar = layout === 'sidebar';
  const openMore = () => setMoreOpen(true);
  return (
    <div className={cn('flex h-dvh overflow-hidden bg-background text-fg-3', !sidebar && 'flex-col')}>
      {sidebar ? null : <CardsTopBar state={state} onMore={openMore} />}
      {sidebar ? <SidebarRail state={state} /> : null}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side='right'
          showCloseButton={false}
          className={cn('w-72 gap-0 p-0', SAFE_AREA_TOP, SAFE_AREA_BOTTOM)}
        >
          <SheetTitle className='sr-only'>More</SheetTitle>
          <Rail state={state} variant='sheet' onNavigate={() => setMoreOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className={cn('flex flex-1 flex-col', sidebar ? 'min-w-0' : 'min-h-0')}>
        {sidebar ? (
          <header
            data-window-drag
            className={cn(
              'shrink-0 border-b border-border select-none md:hidden',
              SAFE_AREA_TOP,
              SAFE_AREA_SIDES
            )}
          >
            <CompactBar state={state} onMore={openMore} className='px-3 desktop:ps-20' />
          </header>
        ) : null}
        {children}
      </main>
      <ErrorBoundary size='silent'>
        <FeedbackDialog state={state} />
      </ErrorBoundary>
      <ErrorBoundary size='silent'>
        <ChangelogDialog />
      </ErrorBoundary>
    </div>
  );
}
