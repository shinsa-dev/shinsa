import type { StatsDay } from '@shinsa/core';
import { AreaChart } from '@shinsa/ui/components/area-chart';
import * as React from 'react';
import { resolveAreaGeometry, resolveNearestIndex } from '@/lib/stats/chart.ts';
import { describeShippingPoint, listShippingPoints } from '@/lib/stats/shipping.ts';

const BOX = { width: 600, height: 120 };

export function ShippingChart({ days }: { days: StatsDay[] }) {
  const points = React.useMemo(() => listShippingPoints(days), [days]);
  const geometry = React.useMemo(
    () =>
      resolveAreaGeometry(
        points.map((point) => point.pullRequests),
        BOX
      ),
    [points]
  );
  const [index, setIndex] = React.useState<number | null>(null);
  const focused = index === null ? null : (points[index] ?? null);
  const first = points[0];
  const last = points.at(-1);
  return (
    <div className='flex flex-col gap-2 px-2 py-1.5'>
      <span className='text-fg-4 text-xs'>
        {focused ? describeShippingPoint(focused) : 'Pull requests merged over time'}
      </span>
      <div className='flex gap-2'>
        <div className='flex h-30 shrink-0 flex-col justify-between text-right text-2xs text-fg-2 tabular-nums'>
          <span>{geometry.max}</span>
          <span>0</span>
        </div>
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <AreaChart
            width={BOX.width}
            height={BOX.height}
            line={geometry.line}
            area={geometry.area}
            guide={index === null ? null : (geometry.points[index]?.x ?? null)}
            className='h-30'
            aria-label='Pull requests merged over time'
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setIndex(resolveNearestIndex(event.clientX - box.left, points.length, box.width));
            }}
            onPointerLeave={() => setIndex(null)}
          />
          <div className='flex justify-between text-2xs text-fg-2'>
            <span>{first?.label}</span>
            <span>{last?.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
