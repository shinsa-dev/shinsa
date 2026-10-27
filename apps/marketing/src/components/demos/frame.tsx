import type { ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CardsTopBar } from '@/components/layout/cards/top-bar.tsx';
import { DesktopChrome } from '@/lib/desktop.ts';
import { type Route, RouteScope } from '@/router.ts';
import { installDemoApi, installDemoConnection, installDemoServer } from '../../lib/demo-server.ts';

if (import.meta.env.SSR) {
  installDemoApi();
  installDemoConnection();
} else {
  installDemoServer();
}

export function DemoRoot({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

export function Window({
  state,
  route,
  inert = false,
  className,
  children,
}: {
  state: ShinsaState;
  route: Route;
  inert?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'corner-superellipse/1.125 relative h-full overflow-hidden rounded-2xl bg-background ring-1 ring-bg-4/70 dark:ring-bg-3',
        className
      )}
    >
      <div className='demo-window-content absolute top-0 left-0 flex origin-top-left flex-col'>
        <RouteScope value={route}>
          <div className='demo-bar-app relative' data-desktop='window' inert>
            <DesktopChrome value>
              <CardsTopBar state={state} />
            </DesktopChrome>
            <div aria-hidden className='demo-lights'>
              <span className='demo-light-close' />
              <span className='demo-light-minimize' />
              <span className='demo-light-zoom' />
            </div>
          </div>
          <div className='demo-bar-browser' inert>
            <CardsTopBar state={state} />
          </div>
          <div className='flex min-h-0 flex-1 flex-col' inert={inert}>
            {children}
          </div>
        </RouteScope>
      </div>
    </div>
  );
}

export function Stage({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'corner-superellipse/1.125 relative overflow-hidden rounded-3xl bg-sidebar p-4 ring-1 ring-bg-3 md:p-8',
        className
      )}
    >
      {children}
    </div>
  );
}
