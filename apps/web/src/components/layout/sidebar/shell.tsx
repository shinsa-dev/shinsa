import type { ShinsaState } from '@shinsa/core';
import { Sheet, SheetContent, SheetTitle } from '@shinsa/ui/components/sheet';
import * as React from 'react';
import { useRailWidth } from '@/lib/preferences/rail-width.ts';
import { CompactBar } from './compact-bar.tsx';
import { Rail } from './rail.tsx';
import { ResizeHandle } from './resize-handle.tsx';

export function SidebarShell({ state, children }: { state: ShinsaState; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const rail = useRailWidth();
  return (
    <div className='flex h-dvh overflow-hidden bg-background text-fg-3'>
      <aside
        style={{ width: rail.width }}
        className='relative hidden shrink-0 border-border border-r md:flex'
      >
        <Rail state={state} />
        <ResizeHandle onPointerDown={rail.startResize} onDoubleClick={rail.resetWidth} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side='left' showCloseButton={false} className='w-72 gap-0 p-0'>
          <SheetTitle className='sr-only'>Queue</SheetTitle>
          <Rail state={state} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className='flex min-w-0 flex-1 flex-col'>
        <CompactBar onMenu={() => setMenuOpen(true)} />
        {children}
      </main>
    </div>
  );
}
