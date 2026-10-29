import { MINUTE_MS, resolveStats, type ShinsaState } from '@shinsa/core';
import * as React from 'react';
import { Choice } from '@/components/controls/choice.tsx';
import { useMinute } from '@/hooks/use-minute.ts';
import {
  DEFAULT_STATS_RANGE,
  parseDayKey,
  parseStatsRange,
  resolveDayKey,
  resolveRangeWindow,
  resolveYearWindow,
  STATS_RANGES,
  type StatsRange,
} from '@/lib/stats/days.ts';
import { listShippingTiles, SHIPPING_SECTION } from '@/lib/stats/shipping.ts';
import {
  listBreakdowns,
  listSavingRows,
  listTaskRows,
  listUsageTiles,
  USAGE_SECTION,
} from '@/lib/stats/usage.ts';
import { updateSearchParams, useSearchParam } from '@/router.ts';
import { SettingsGroup } from '../group.tsx';
import { ShippingChart } from './shipping-chart.tsx';
import { ShippingGraph } from './shipping-graph.tsx';
import { StatTile, StatTiles } from './stat-tile.tsx';
import { UsageChart } from './usage-chart.tsx';
import { Breakdown, Savings, TopTasks } from './usage-tables.tsx';

function useStatsRange() {
  const range = parseStatsRange(useSearchParam('range') ?? '');
  const choose = (next: StatsRange) =>
    updateSearchParams({ range: next === DEFAULT_STATS_RANGE ? null : String(next) }, { replace: true });
  return [range, choose] as const;
}

export function StatsSettings({ state }: { state: ShinsaState }) {
  const [range, chooseRange] = useStatsRange();
  const minute = useMinute();
  const day = resolveDayKey(minute * MINUTE_MS);
  const year = React.useMemo(
    () => resolveStats(state, resolveYearWindow(parseDayKey(day).getTime())),
    [state.tasks, state.runs, day]
  );
  const stats = React.useMemo(
    () => resolveStats(state, resolveRangeWindow(parseDayKey(day).getTime(), range)),
    [state.tasks, state.runs, day, range]
  );
  return (
    <>
      <Choice<`${StatsRange}`>
        label='Stats range'
        items={STATS_RANGES.map((entry) => ({ value: entry.value, label: entry.label }))}
        value={`${range}`}
        onValueChange={(next) => chooseRange(parseStatsRange(next))}
        className='self-start'
      />
      <SettingsGroup title={SHIPPING_SECTION} className='gap-1.5'>
        <StatTiles>
          {listShippingTiles(stats, year).map((tile) => (
            <StatTile key={tile.key} label={tile.label} value={tile.value} detail={tile.detail} />
          ))}
        </StatTiles>
        <ShippingGraph year={year} />
        <ShippingChart days={stats.days} />
      </SettingsGroup>
      <SettingsGroup title={USAGE_SECTION} className='gap-3'>
        <StatTiles>
          {listUsageTiles(stats).map((tile) => (
            <StatTile key={tile.key} label={tile.label} value={tile.value} detail={tile.detail} />
          ))}
        </StatTiles>
        <UsageChart days={stats.days} />
        <div className='grid gap-3 md:grid-cols-3'>
          {listBreakdowns(stats).map((breakdown) => (
            <Breakdown key={breakdown.key} title={breakdown.title} rows={breakdown.rows} />
          ))}
        </div>
        <TopTasks state={state} rows={listTaskRows(stats.tasks)} />
        <Savings state={state} rows={listSavingRows(stats.savings)} />
      </SettingsGroup>
    </>
  );
}
