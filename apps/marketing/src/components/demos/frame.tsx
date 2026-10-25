import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
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
  title,
  inert = false,
  className,
  children,
}: {
  title: string;
  inert?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'corner-superellipse/1.125 flex h-full flex-col overflow-hidden rounded-2xl bg-background shadow-lg ring-1 ring-bg-4/70 dark:ring-bg-3',
        className
      )}
    >
      <div className='relative flex h-9 shrink-0 items-center gap-1.5 border-bg-3 border-b bg-sidebar px-3.5'>
        <span className='size-2.5 rounded-full bg-bg-4' />
        <span className='size-2.5 rounded-full bg-bg-4' />
        <span className='size-2.5 rounded-full bg-bg-4' />
        <span className='absolute inset-x-0 text-center text-2xs text-fg-2'>{title}</span>
      </div>
      <div className='relative min-h-0 flex-1 overflow-hidden'>
        <div className='demo-window-content absolute top-0 left-0 origin-top-left' inert={inert}>
          {children}
        </div>
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
