import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

type AreaChartProps = {
  /** The drawing's own units; the chart stretches to its box, the stroke keeps its width. */
  width: number;
  height: number;
  /** SVG path data for the line and the closed area under it, in those units. */
  line: string;
  area: string;
  className?: string;
};

/**
 * A filled line chart in the accent: a 2px line over a wash that fades to
 * nothing at the baseline. It draws the data only; the caller lays the grid,
 * the crosshair, the point under the pointer and its readout over it.
 */
function AreaChart({ width, height, line, area, className }: AreaChartProps) {
  const gradient = React.useId();
  return (
    <svg
      data-slot='area-chart'
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio='none'
      className={cn('block size-full overflow-visible', className)}
    >
      <defs>
        <linearGradient id={gradient} x1='0' x2='0' y1='0' y2='1'>
          <stop offset='0%' stopColor='var(--primary)' stopOpacity={0.24} />
          <stop offset='100%' stopColor='var(--primary)' stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradient})`} />
      <path
        d={line}
        fill='none'
        vectorEffect='non-scaling-stroke'
        strokeWidth={2}
        strokeLinejoin='round'
        strokeLinecap='round'
        className='stroke-primary'
      />
    </svg>
  );
}

export { AreaChart };
