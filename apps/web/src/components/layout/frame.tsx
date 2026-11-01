import type { ShinsaState } from '@shinsa/core';
import { Sheet, SheetContent, SheetTitle } from '@shinsa/ui/components/sheet';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { FeedbackSheet } from '@/components/feedback/sheet.tsx';
import type { LayoutPreference } from '@/lib/preferences/layout.ts';
import { useRailWidth } from '@/lib/preferences/rail-width.ts';
import { CardsTopBar } from './cards/top-bar.tsx';
import { CompactBar } from './sidebar/compact-bar.tsx';
import { Rail } from './sidebar/rail.tsx';
import { ResizeHandle } from './sidebar/resize-handle.tsx';

function SidebarRail({ state }: { state: ShinsaState }) {
  const rail = useRailWidth();
  return (
    <aside style={{ width: rail.width }} className='relative hidden shrink-0 border-border border-r md:flex'>
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
  const [menuOpen, setMenuOpen] = React.useState(false);
  const sidebar = layout === 'sidebar';
  return (
    <div className={cn('flex h-dvh overflow-hidden bg-background text-fg-3', !sidebar && 'flex-col')}>
      {sidebar ? null : <CardsTopBar state={state} />}
      {sidebar ? <SidebarRail state={state} /> : null}
      {sidebar ? (
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side='left' showCloseButton={false} className='w-72 gap-0 p-0'>
            <SheetTitle className='sr-only'>Queue</SheetTitle>
            <Rail state={state} onNavigate={() => setMenuOpen(false)} />
          </SheetContent>
        </Sheet>
      ) : null}
      <main className={cn('flex flex-1 flex-col', sidebar ? 'min-w-0' : 'min-h-0')}>
        {sidebar ? <CompactBar onMenu={() => setMenuOpen(true)} /> : null}
        {children}
      </main>
      <ErrorBoundary size='silent'>
        <FeedbackSheet state={state} />
      </ErrorBoundary>
    </div>
  );
}
