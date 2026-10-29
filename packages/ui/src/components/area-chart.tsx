import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

type AreaChartProps = {
  /** The drawing's own units; the chart stretches to its box, the stroke keeps its width. */
  width: number;
  height: number;
  /** SVG path data for the line and the closed area under it, in those units. */
  line: string;
  area: string;
  /** The x of a guide line across the chart (the point under the pointer), or null for none. */
  guide?: number | null;
  className?: string;
  'aria-label': string;
  onPointerMove?: React.PointerEventHandler<SVGSVGElement>;
  onPointerLeave?: React.PointerEventHandler<SVGSVGElement>;
};

/** A filled line chart in the accent: the line, a wash under it and an optional guide line. */
function AreaChart({ width, height, line, area, guide = null, className, ...props }: AreaChartProps) {
  return (
    <svg
      data-slot='area-chart'
      role='img'
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio='none'
      className={cn('block w-full overflow-visible', className)}
      {...props}
    >
      <path d={area} className='fill-primary-a2' />
      {guide !== null && (
        <line
          x1={guide}
          x2={guide}
          y1={0}
          y2={height}
          vectorEffect='non-scaling-stroke'
          strokeWidth={1}
          className='stroke-fg-1'
        />
      )}
      <path
        d={line}
        fill='none'
        vectorEffect='non-scaling-stroke'
        strokeWidth={1.5}
        strokeLinejoin='round'
        strokeLinecap='round'
        className='stroke-primary'
      />
    </svg>
  );
}

export { AreaChart };
