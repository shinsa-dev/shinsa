import type { StatsDay } from '@shinsa/core';
import { ChartTooltipRow, ChartTooltipTitle } from '@shinsa/ui/components/chart-tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { formatTokenCount } from '@/lib/format/money.ts';
import { listAxisIndexes } from '@/lib/stats/chart.ts';
import { formatShortDay } from '@/lib/stats/days.ts';
import { listTokenBars, listTokenPoints, TOKEN_KINDS, type TokenKind } from '@/lib/stats/usage.ts';
import { ChartPanel, ChartPlot } from './chart-plot.tsx';

const KIND_FILL: Record<TokenKind, string> = {
  cacheReadTokens: 'bg-primary/30',
  cacheWriteTokens: 'bg-primary/60',
  inputTokens: 'bg-primary',
  outputTokens: 'bg-fg-3',
};

const CHART_LABEL = 'Tokens over time';

function TokenLegend() {
  return TOKEN_KINDS.map(({ kind, label }) => (
    <span key={kind} className='inline-flex items-center gap-1'>
      <span className={cn('size-2 rounded-xs', KIND_FILL[kind])} />
      {label}
    </span>
  ));
}

export function UsageChart({ days }: { days: StatsDay[] }) {
  const { bars, max } = React.useMemo(() => listTokenBars(listTokenPoints(days)), [days]);
  const labels = listAxisIndexes(bars.length).map((index) => ({
    index,
    label: formatShortDay(bars[index]?.from ?? ''),
  }));
  return (
    <ChartPanel title={CHART_LABEL} aside={<TokenLegend />}>
      <ChartPlot
        label={CHART_LABEL}
        layout='bands'
        count={bars.length}
        max={max}
        values={bars.map((bar) => bar.tokens)}
        formatTick={formatTokenCount}
        labels={labels}
        readout={(index) => {
          const bar = bars[index];
          if (!bar) return null;
          return (
            <>
              <ChartTooltipTitle>{bar.label}</ChartTooltipTitle>
              <ChartTooltipRow label='Total' value={formatTokenCount(bar.tokens)} />
              {[...bar.segments].reverse().map((segment) => (
                <ChartTooltipRow
                  key={segment.kind}
                  swatch={KIND_FILL[segment.kind]}
                  label={TOKEN_KINDS.find((entry) => entry.kind === segment.kind)?.label}
                  value={formatTokenCount(segment.tokens)}
                />
              ))}
            </>
          );
        }}
      >
        {(hovered) => (
          <div className='absolute inset-0 flex items-end gap-1'>
            {bars.map((bar, index) => (
              <div
                key={bar.from}
                data-bar={bar.from}
                className={cn(
                  'flex h-full min-w-0 flex-1 justify-center transition-opacity duration-150',
                  hovered !== null && hovered !== index && 'opacity-40'
                )}
              >
                <div
                  className='flex w-full max-w-6 flex-col-reverse self-end overflow-hidden rounded-t-xs'
                  style={{ height: `${(bar.tokens / max) * 100}%` }}
                >
                  {bar.segments.map((segment) => (
                    <span
                      key={segment.kind}
                      className={cn('w-full shrink-0', KIND_FILL[segment.kind])}
                      style={{ height: `${bar.tokens === 0 ? 0 : (segment.tokens / bar.tokens) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ChartPlot>
    </ChartPanel>
  );
}
