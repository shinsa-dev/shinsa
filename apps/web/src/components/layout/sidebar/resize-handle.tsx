import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import type * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';

export function ResizeHandle({
  onPointerDown,
  onDoubleClick,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <Hint
      side='right'
      followCursor
      label={
        <span className='whitespace-nowrap'>
          Resize the sidebar <TooltipLabel>· Double-click to reset</TooltipLabel>
        </span>
      }
    >
      <button
        type='button'
        aria-label='Resize the sidebar'
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        className='absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors after:duration-150 hover:after:bg-primary-4 active:after:bg-primary-4'
      />
    </Hint>
  );
}
