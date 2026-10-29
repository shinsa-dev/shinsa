import type { StatsDay } from '@shinsa/core';
import { AreaChart } from '@shinsa/ui/components/area-chart';
import { ChartTooltipRow, ChartTooltipTitle } from '@shinsa/ui/components/chart-tooltip';
import * as React from 'react';
import { listAxisIndexes, resolveAreaGeometry } from '@/lib/stats/chart.ts';
import { formatShortDay } from '@/lib/stats/days.ts';
import { formatPullRequests, listShippingPoints } from '@/lib/stats/shipping.ts';
import { ChartPanel, ChartPlot } from './chart-plot.tsx';

const BOX = { width: 600, height: 160 };

const CHART_LABEL = 'Pull requests merged over time';

export function ShippingChart({ days, aside }: { days: StatsDay[]; aside: string }) {
  const points = React.useMemo(() => listShippingPoints(days), [days]);
  const values = points.map((point) => point.pullRequests);
  const geometry = React.useMemo(() => resolveAreaGeometry(values, BOX), [values.join()]);
  const labels = listAxisIndexes(points.length).map((index) => ({
    index,
    label: formatShortDay(points[index]?.from ?? ''),
  }));
  return (
    <ChartPanel title={CHART_LABEL} aside={aside}>
      <ChartPlot
        label={CHART_LABEL}
        layout='points'
        count={points.length}
        max={geometry.max}
        values={values}
        formatTick={(tick) => String(tick)}
        labels={labels}
        readout={(index) => (
          <>
            <ChartTooltipTitle>{points[index]?.label}</ChartTooltipTitle>
            <ChartTooltipRow value={formatPullRequests(points[index]?.pullRequests ?? 0)} />
          </>
        )}
      >
        {() => (
          <AreaChart
            width={BOX.width}
            height={BOX.height}
            line={geometry.line}
            area={geometry.area}
            className='absolute inset-0'
          />
        )}
      </ChartPlot>
    </ChartPanel>
  );
}
