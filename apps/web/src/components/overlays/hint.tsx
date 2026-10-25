import { Kbd } from '@shinsa/ui/components/kbd';
import { TooltipLabel, useTooltipTrigger } from '@shinsa/ui/components/tooltip';
import type * as React from 'react';

export function Hint({
  label,
  detail,
  shortcut,
  side,
  followCursor = false,
  children,
}: {
  label: React.ReactNode;
  detail?: string | null;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  followCursor?: boolean;
  children: React.ReactElement<Record<string, unknown>>;
}) {
  return useTooltipTrigger(children, {
    side,
    trackCursorAxis: followCursor ? 'y' : undefined,
    className: detail ? 'flex-col items-start gap-px' : undefined,
    content: (
      <>
        {label}
        {detail && <TooltipLabel>{detail}</TooltipLabel>}
        {shortcut && <Kbd className='ms-1'>{shortcut}</Kbd>}
      </>
    ),
  });
}
