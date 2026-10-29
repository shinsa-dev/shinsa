import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

/** How far from either edge, in pixels, the readout stops centring on its point and hugs that edge instead. */
const EDGE = 88;

type ChartTooltipProps = {
  /** The point the readout sits above, in pixels from the chart's top left corner. */
  x: number;
  y: number;
  /** The chart's width in pixels, so the readout never hangs over either edge. */
  width: number;
  className?: string;
  children: React.ReactNode;
};

function resolveShift(x: number, width: number) {
  if (x < EDGE) return '-12px';
  if (x > width - EDGE) return 'calc(-100% + 12px)';
  return '-50%';
}

/**
 * The readout a chart shows under the pointer: the page tooltip's chip, placed
 * by the chart above the point it reads instead of opened by a trigger. It fades
 * in and glides from point to point, so moving along the chart never jumps.
 * The chart's box must be `relative`.
 */
function ChartTooltip({ x, y, width, className, children }: ChartTooltipProps) {
  return (
    <div
      data-slot='chart-tooltip'
      role='status'
      className={cn(
        'corner-superellipse/1.125 pointer-events-none absolute z-20 flex w-max max-w-64 flex-col gap-1 rounded-control border border-border bg-popover px-2 py-1.5 text-2xs text-fg-4 leading-[1.35] starting:opacity-0 shadow-2 transition-[left,top,transform,opacity] duration-200 ease-out',
        className
      )}
      style={{ left: x, top: y, transform: `translate(${resolveShift(x, width)}, calc(-100% - 10px))` }}
    >
      {children}
    </div>
  );
}

/** The readout's first line: what the point is, such as its date. */
function ChartTooltipTitle({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot='chart-tooltip-title' className={cn('text-fg-2', className)} {...props} />;
}

/** One value of the readout: a short key in its series' colour, its name, and the value, which leads. */
function ChartTooltipRow({
  swatch,
  label,
  value,
  className,
}: {
  swatch?: string;
  label?: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <span data-slot='chart-tooltip-row' className={cn('flex items-center gap-1.5', className)}>
      {swatch && <span aria-hidden className={cn('h-0.5 w-2.5 shrink-0 rounded-full', swatch)} />}
      {label && <span className='min-w-0 flex-1 truncate text-fg-2'>{label}</span>}
      <span className='ml-auto font-medium text-fg-4 tabular-nums'>{value}</span>
    </span>
  );
}

export { ChartTooltip, ChartTooltipRow, ChartTooltipTitle };
