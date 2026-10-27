import { TooltipLabel, useTooltipTrigger } from '@shinsa/ui/components/tooltip';
import type * as React from 'react';
import { useMinute } from '@/hooks/use-minute.ts';
import { formatAge, formatClock, formatDay, formatDuration, formatTimeAgo } from '@/lib/format/time.ts';

function DayAndClock({ at }: { at: number }) {
  return (
    <span className='whitespace-nowrap'>
      {formatDay(at)} <TooltipLabel>{formatClock(at)}</TooltipLabel>
    </span>
  );
}

function ClockRange({ from, to, ongoing }: { from: number; to: number; ongoing: boolean }) {
  return (
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
  );
}

function useTimeTrigger(at: number, content: React.ReactNode, text: string, detail?: string) {
  return useTooltipTrigger(
    <time dateTime={new Date(at).toISOString()} className='cursor-default'>
      {text}
    </time>,
    {
      className: detail ? 'flex-col items-start gap-px' : undefined,
      content: (
        <>
          {content}
          {detail && <TooltipLabel>{detail}</TooltipLabel>}
        </>
      ),
    }
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
  const label = text ? text(now) : compact ? formatAge(at, now) : formatTimeAgo(at, now);
  return useTimeTrigger(at, <DayAndClock at={at} />, label, detail);
}

export function Duration({ from, to, ongoing = false }: { from: number; to: number; ongoing?: boolean }) {
  return useTimeTrigger(
    from,
    <ClockRange from={from} to={to} ongoing={ongoing} />,
    formatDuration(to - from)
  );
}
