import type { StatsDay } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { formatTokenCount } from '@/lib/format/money.ts';
import {
  describeTokenBar,
  listTokenBars,
  listTokenPoints,
  TOKEN_KINDS,
  type TokenBar,
  type TokenKind,
} from '@/lib/stats/usage.ts';

const KIND_FILL: Record<TokenKind, string> = {
  cacheReadTokens: 'bg-primary-a2',
  cacheWriteTokens: 'bg-primary-a3',
  inputTokens: 'bg-primary-a4',
  outputTokens: 'bg-primary-4',
};

const CHART_LABEL = 'Tokens over time';

export function UsageChart({ days }: { days: StatsDay[] }) {
  const { bars, max } = React.useMemo(() => listTokenBars(listTokenPoints(days)), [days]);
  const [hovered, setHovered] = React.useState<TokenBar | null>(null);
  return (
    <div className='flex flex-col gap-2 px-2 py-1.5'>
      <span className='text-fg-4 text-xs'>{hovered ? describeTokenBar(hovered) : CHART_LABEL}</span>
      <div className='flex gap-2'>
        <div className='flex h-30 shrink-0 flex-col justify-between text-right text-2xs text-fg-2 tabular-nums'>
          <span>{formatTokenCount(max)}</span>
          <span>0</span>
        </div>
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <div
            role='img'
            aria-label={CHART_LABEL}
            className='flex h-30 items-end gap-px'
            onPointerLeave={() => setHovered(null)}
          >
            {bars.map((bar) => (
              <div
                key={bar.from}
                data-bar={bar.from}
                className='flex h-full min-w-0 flex-1 flex-col-reverse'
                onPointerEnter={() => setHovered(bar)}
              >
                {bar.segments.map((segment) => (
                  <span
                    key={segment.kind}
                    className={cn('w-full', KIND_FILL[segment.kind])}
                    style={{ height: `${segment.share * 100}%` }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className='flex justify-between text-2xs text-fg-2'>
            <span>{bars[0]?.label}</span>
            <span>{bars.at(-1)?.label}</span>
          </div>
        </div>
      </div>
      <div className='flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-2xs text-fg-2'>
        {TOKEN_KINDS.map(({ kind, label }) => (
          <span key={kind} className='inline-flex items-center gap-1'>
            <span className={cn('size-2.5 rounded-xs', KIND_FILL[kind])} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
