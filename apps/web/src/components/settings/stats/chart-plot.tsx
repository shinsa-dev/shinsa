import { ChartTooltip } from '@shinsa/ui/components/chart-tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { listChartTicks, resolveNearestIndex, resolvePointShare } from '@/lib/stats/chart.ts';
import { STAT_PANEL } from './stat-tile.tsx';

export type PlotLayout = 'points' | 'bands';

interface PlotHover {
  index: number;
  width: number;
  height: number;
  pointer: number;
}

export function ChartPanel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(STAT_PANEL, 'flex min-w-0 flex-col gap-3 px-3 pt-2.5 pb-2')}>
      <div className='flex min-h-5 items-center justify-between gap-3'>
        <span className='truncate font-medium text-fg-4 text-xs'>{title}</span>
        {aside && <span className='flex shrink-0 items-center gap-3 text-2xs text-fg-2'>{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function resolveShare(layout: PlotLayout, index: number, count: number) {
  return layout === 'bands' ? (index + 0.5) / Math.max(1, count) : resolvePointShare(index, count);
}

function resolveIndex(layout: PlotLayout, x: number, count: number, width: number) {
  if (layout === 'points') return resolveNearestIndex(x, count, width);
  if (width <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
}

function AxisLabels({
  labels,
  count,
  layout,
}: {
  labels: { index: number; label: string }[];
  count: number;
  layout: PlotLayout;
}) {
  return (
    <div aria-hidden className='relative h-4 text-2xs text-fg-2'>
      {labels.map(({ index, label }, position) => {
        const edge = position === 0 ? 'start' : position === labels.length - 1 ? 'end' : 'middle';
        return (
          <span
            key={index}
            className={cn(
              'absolute top-0 whitespace-nowrap',
              edge === 'middle' && '-translate-x-1/2',
              edge === 'end' && '-translate-x-full'
            )}
            style={{ left: `${resolveShare(layout, index, count) * 100}%` }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export function ChartPlot({
  label,
  layout,
  count,
  max,
  values,
  formatTick,
  labels,
  readout,
  children,
}: {
  label: string;
  layout: PlotLayout;
  count: number;
  max: number;
  values: number[];
  formatTick: (value: number) => string;
  labels: { index: number; label: string }[];
  readout: (index: number) => React.ReactNode;
  children: (hovered: number | null) => React.ReactNode;
}) {
  const [hover, setHover] = React.useState<PlotHover | null>(null);
  const ticks = listChartTicks(max);
  const hovered = hover && hover.index < count ? hover : null;
  const share = hovered ? resolveShare(layout, hovered.index, count) : 0;
  const level = hovered ? 1 - (values[hovered.index] ?? 0) / max : 1;
  return (
    <div className='flex gap-2'>
      <div aria-hidden className='relative h-40 w-8 shrink-0 text-right text-2xs text-fg-2 tabular-nums'>
        {ticks.map((tick) => (
          <span
            key={tick}
            className='absolute right-0 -translate-y-1/2'
            style={{ top: `${(1 - tick / max) * 100}%` }}
          >
            {formatTick(tick)}
          </span>
        ))}
      </div>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <div
          role='img'
          aria-label={label}
          className='relative h-40'
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const index = resolveIndex(layout, event.clientX - box.left, count, box.width);
            setHover({ index, width: box.width, height: box.height, pointer: event.clientY - box.top });
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden
              className={cn('absolute inset-x-0 border-t', tick === 0 ? 'border-fg-1' : 'border-border')}
              style={{ top: `${(1 - tick / max) * 100}%` }}
            />
          ))}
          {children(hovered?.index ?? null)}
          {hovered && layout === 'points' && (
            <>
              <span
                aria-hidden
                className='pointer-events-none absolute inset-y-0 w-px bg-fg-1'
                style={{ left: `${share * 100}%` }}
              />
              <span
                aria-hidden
                className='pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card'
                style={{ left: `${share * 100}%`, top: `${level * 100}%` }}
              />
            </>
          )}
          {hovered && (
            <ChartTooltip
              x={share * hovered.width}
              y={layout === 'points' ? level * hovered.height : hovered.pointer}
              width={hovered.width}
            >
              {readout(hovered.index)}
            </ChartTooltip>
          )}
        </div>
        <AxisLabels labels={labels} count={count} layout={layout} />
      </div>
    </div>
  );
}
