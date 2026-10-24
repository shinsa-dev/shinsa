import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import type * as React from 'react';

export function PageScroll({
  children,
  viewportRef,
}: {
  children: React.ReactNode;
  viewportRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <ScrollArea viewportRef={viewportRef} className='min-h-0 flex-1'>
      {children}
    </ScrollArea>
  );
}
