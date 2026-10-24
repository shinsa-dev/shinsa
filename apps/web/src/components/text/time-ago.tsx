import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipProvider,
  TooltipTrigger,
} from '@shinsa/ui/components/tooltip';
import type * as React from 'react';
import { useMinute } from '@/hooks/use-minute.ts';
import { formatAge, formatClock, formatDay, formatDuration, formatTimeAgo } from '@/lib/format/time.ts';

const TIME_TOOLTIP_DELAY = 150;

function TimeTooltip({
  at,
  content,
  detail,
  children,
}: {
  at: number;
  content: React.ReactNode;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delay={TIME_TOOLTIP_DELAY}>
      <Tooltip>
        <TooltipTrigger
          render={
            <time dateTime={new Date(at).toISOString()} className='cursor-default'>
              {children}
            </time>
          }
        />
        <TooltipContent className={detail ? 'flex-col items-start gap-px' : undefined}>
          {content}
          {detail && <TooltipLabel>{detail}</TooltipLabel>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function TimeAgo({
  at,
  text,
  compact = false,
  detail,
}: {
  at: number;
  text?: (now: number) => string;
  compact?: boolean;
  detail?: string;
}) {
  useMinute();
  const now = Date.now();
  return (
    <TimeTooltip
      at={at}
      detail={detail}
      content={
        <span className='whitespace-nowrap'>
          {formatDay(at)} <TooltipLabel>{formatClock(at)}</TooltipLabel>
        </span>
      }
    >
      {text ? text(now) : compact ? formatAge(at, now) : formatTimeAgo(at, now)}
    </TimeTooltip>
  );
}

export function Duration({ from, to, ongoing = false }: { from: number; to: number; ongoing?: boolean }) {
  return (
    <TimeTooltip
      at={from}
      content={
        <span className='whitespace-nowrap'>
          {ongoing ? (
            <>
              <TooltipLabel>Since</TooltipLabel> {formatClock(from)}
            </>
          ) : (
            <>
              {formatClock(from)} <TooltipLabel>to</TooltipLabel> {formatClock(to)}
            </>
          )}{' '}
          <TooltipLabel>{formatDay(from)}</TooltipLabel>
        </span>
      }
    >
      {formatDuration(to - from)}
    </TimeTooltip>
  );
}
