import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import type * as React from 'react';

export function PageScroll({
  children,
  viewportRef,
  fade = true,
}: {
  children: React.ReactNode;
  viewportRef?: React.Ref<HTMLDivElement>;
  fade?: boolean | 'end';
}) {
  return (
    <ScrollArea viewportRef={viewportRef} fade={fade} className='min-h-0 flex-1'>
      {children}
    </ScrollArea>
  );
}
