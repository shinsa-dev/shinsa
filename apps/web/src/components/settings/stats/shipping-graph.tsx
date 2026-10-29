import type { Stats } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import {
  describeShippingCell,
  describeShippingYear,
  resolveShippingGrid,
  type ShippingCell,
  type ShippingLevel,
} from '@/lib/stats/shipping.ts';

const LEVEL_FILL: Record<ShippingLevel, string> = {
  0: 'bg-bg-a2',
  1: 'bg-primary-a2',
  2: 'bg-primary-a3',
  3: 'bg-primary-a4',
  4: 'bg-primary-4',
};

const LEVELS: ShippingLevel[] = [0, 1, 2, 3, 4];

export function ShippingGraph({ year }: { year: Stats }) {
  const grid = React.useMemo(() => resolveShippingGrid(year.days), [year.days]);
  const [hovered, setHovered] = React.useState<ShippingCell | null>(null);
  const columns = { gridTemplateColumns: `repeat(${grid.weeks.length}, minmax(0, 1fr))` };
  return (
    <div className='flex flex-col gap-2 px-2 py-1.5'>
      <span className='text-fg-4 text-xs'>
        {hovered ? describeShippingCell(hovered) : describeShippingYear(year)}
      </span>
      <div className='flex flex-col gap-1'>
        <div className='grid gap-1' style={columns} aria-hidden>
          {grid.weeks.map((cells, week) => {
            const month = grid.months.find((entry) => entry.week === week);
            return (
              <span
                key={cells.find(Boolean)?.day}
                className='overflow-visible whitespace-nowrap text-2xs text-fg-2'
              >
                {month?.label ?? ''}
              </span>
            );
          })}
        </div>
        <div
          role='img'
          aria-label={describeShippingYear(year)}
          className='grid grid-flow-col grid-rows-7 gap-1'
          style={columns}
          onPointerLeave={() => setHovered(null)}
        >
          {grid.weeks.flatMap((week, column) =>
            week.map((cell, row) => (
              <span
                key={cell?.day ?? `${column}-${row}`}
                className={cn('aspect-square rounded-xs', cell ? LEVEL_FILL[cell.level] : 'invisible')}
                onPointerEnter={cell ? () => setHovered(cell) : undefined}
              />
            ))
          )}
        </div>
      </div>
      <div className='flex items-center justify-end gap-1 text-2xs text-fg-2'>
        <span>Less</span>
        {LEVELS.map((level) => (
          <span key={level} className={cn('size-2.5 rounded-xs', LEVEL_FILL[level])} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
