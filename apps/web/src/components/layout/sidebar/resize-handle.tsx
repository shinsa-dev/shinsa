import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';

export function ResizeHandle({
  label = 'Resize the sidebar',
  edge = 'right',
  onPointerDown,
  onDoubleClick,
}: {
  label?: string;
  edge?: 'left' | 'right';
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <Hint
      side={edge}
      followCursor
      label={
        <span className='whitespace-nowrap'>
          {label} <TooltipLabel>· Double-click to reset</TooltipLabel>
        </span>
      }
    >
      <button
        type='button'
        aria-label={label}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        className={cn(
          'absolute inset-y-0 z-10 w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary-4 active:after:bg-primary-4',
          edge === 'right' ? '-right-1' : '-left-1'
        )}
      />
    </Hint>
  );
}
