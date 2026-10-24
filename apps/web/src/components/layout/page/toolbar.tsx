import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-9 shrink-0 items-center gap-2 border-border border-b ps-3 pe-2', className)}>
      {children}
    </div>
  );
}
