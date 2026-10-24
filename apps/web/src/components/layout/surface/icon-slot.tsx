import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { ICON_SLOT } from '@/components/layout/surface/card.ts';

export function IconSlot({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span data-icon-slot className={cn(ICON_SLOT, className)}>
      {children}
    </span>
  );
}
