import { Kbd } from '@shinsa/ui/components/kbd';
import { Tooltip, TooltipContent, TooltipLabel, TooltipTrigger } from '@shinsa/ui/components/tooltip';
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
  return (
    <Tooltip trackCursorAxis={followCursor ? 'y' : undefined}>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className={detail ? 'flex-col items-start gap-px' : undefined}>
        {label}
        {detail && <TooltipLabel>{detail}</TooltipLabel>}
        {shortcut && <Kbd className='ms-1'>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
