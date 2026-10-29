import type { Stats } from '@shinsa/core';
import { ChartTooltip, ChartTooltipRow, ChartTooltipTitle } from '@shinsa/ui/components/chart-tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { formatDayLabel } from '@/lib/stats/days.ts';
import {
  describeShippingYear,
  formatPullRequests,
  resolveShippingGrid,
  type ShippingCell,
  type ShippingLevel,
} from '@/lib/stats/shipping.ts';
import { ChartPanel } from './chart-plot.tsx';

const LEVEL_FILL: Record<ShippingLevel, string> = {
  0: 'bg-bg-a2',
  1: 'bg-primary/25',
  2: 'bg-primary/45',
  3: 'bg-primary/70',
  4: 'bg-primary',
};

const LEVELS: ShippingLevel[] = [0, 1, 2, 3, 4];

const WEEKDAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

interface HoveredCell {
  cell: ShippingCell;
  x: number;
  y: number;
  width: number;
}

function ShippingLegend() {
  return (
    <span className='inline-flex items-center gap-1'>
      Less
      {LEVELS.map((level) => (
        <span key={level} className={cn('size-2 rounded-xs', LEVEL_FILL[level])} />
      ))}
      More
    </span>
  );
}

export function ShippingGraph({ year }: { year: Stats }) {
  const grid = React.useMemo(() => resolveShippingGrid(year.days), [year.days]);
  const [hovered, setHovered] = React.useState<HoveredCell | null>(null);
  const board = React.useRef<HTMLDivElement>(null);
  const columns = { gridTemplateColumns: `1.5rem repeat(${grid.weeks.length}, minmax(0, 1fr))` };
  const show = (cell: ShippingCell, element: Element) => {
    const frame = board.current?.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    if (!frame) return;
    setHovered({
      cell,
      x: box.left - frame.left + box.width / 2,
      y: box.top - frame.top,
      width: frame.width,
    });
  };
  return (
    <ChartPanel title={describeShippingYear(year)} aside={<ShippingLegend />}>
      <div ref={board} className='relative flex flex-col gap-1'>
        <div aria-hidden className='grid h-4 gap-1' style={columns}>
          <span />
          {grid.weeks.map((cells, week) => (
            <span
              key={cells.find(Boolean)?.day}
              className='overflow-visible whitespace-nowrap text-2xs text-fg-2'
            >
              {grid.months.find((entry) => entry.week === week)?.label ?? ''}
            </span>
          ))}
        </div>
        <div
          role='img'
          aria-label={describeShippingYear(year)}
          className='grid grid-flow-col grid-rows-7 gap-1'
          style={columns}
          onPointerLeave={() => setHovered(null)}
        >
          {WEEKDAYS.map((weekday, index) => (
            <span
              key={`${weekday}-${String(index)}`}
              aria-hidden
              className='flex items-center overflow-visible text-2xs text-fg-2 leading-none'
            >
              {weekday}
            </span>
          ))}
          {grid.weeks.flatMap((week, column) =>
            week.map((cell, row) => (
              <span
                key={cell?.day ?? `${column}-${row}`}
                data-day={cell?.day}
                className={cn(
                  'aspect-square rounded-xs',
                  cell ? LEVEL_FILL[cell.level] : 'invisible',
                  hovered?.cell.day === cell?.day && 'ring-1 ring-fg-3'
                )}
                onPointerEnter={cell ? (event) => show(cell, event.currentTarget) : undefined}
              />
            ))
          )}
        </div>
        {hovered && (
          <ChartTooltip x={hovered.x} y={hovered.y} width={hovered.width}>
            <ChartTooltipTitle>{formatDayLabel(hovered.cell.day)}</ChartTooltipTitle>
            <ChartTooltipRow value={formatPullRequests(hovered.cell.pullRequests)} />
          </ChartTooltip>
        )}
      </div>
    </ChartPanel>
  );
}
