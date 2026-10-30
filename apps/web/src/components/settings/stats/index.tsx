import { MINUTE_MS, resolveProjectStatsSource, resolveStats, type ShinsaState } from '@shinsa/core';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { useMinute } from '@/hooks/use-minute.ts';
import { selectFocus } from '@/lib/focus.ts';
import {
  DEFAULT_STATS_RANGE,
  parseDayKey,
  parseStatsRange,
  resolveDayKey,
  resolveFirstActivity,
  resolveStatsWindow,
  resolveYearWindow,
  STATS_RANGES,
  type StatsRange,
} from '@/lib/stats/days.ts';
import { listShippingTiles, SHIPPING_SECTION } from '@/lib/stats/shipping.ts';
import { listBreakdowns, listTaskRows, listUsageTiles, USAGE_SECTION } from '@/lib/stats/usage.ts';
import { updateSearchParams, useSearchParam } from '@/router.ts';
import { SettingsGroup } from '../group.tsx';
import { ShippingChart } from './shipping-chart.tsx';
import { ShippingGraph } from './shipping-graph.tsx';
import { StatTiles } from './stat-tile.tsx';
import { UsageChart } from './usage-chart.tsx';
import { Breakdown, TopTasks } from './usage-tables.tsx';

function useStatsRange() {
  const range = parseStatsRange(useSearchParam('range') ?? '');
  const choose = (next: StatsRange) =>
    updateSearchParams({ range: next === DEFAULT_STATS_RANGE ? null : String(next) }, { replace: true });
  return [range, choose] as const;
}

export function StatisticsRange() {
  const [range, chooseRange] = useStatsRange();
  return (
    <SelectField<`${StatsRange}`>
      label='Statistics range'
      items={STATS_RANGES}
      value={`${range}`}
      onValueChange={(next) => chooseRange(parseStatsRange(next))}
      size='sm'
    />
  );
}

export function StatisticsSettings({ state }: { state: ShinsaState }) {
  const [range] = useStatsRange();
  const minute = useMinute();
  const day = resolveDayKey(minute * MINUTE_MS);
  const focus = selectFocus(state);
  const projectId = focus?.id ?? null;
  const source = React.useMemo(
    () => resolveProjectStatsSource(state, projectId),
    [state.tasks, state.runs, state.repos, projectId]
  );
  const year = React.useMemo(
    () => resolveStats(source, resolveYearWindow(parseDayKey(day).getTime())),
    [source, day]
  );
  const stats = React.useMemo(
    () =>
      resolveStats(
        source,
        resolveStatsWindow(parseDayKey(day).getTime(), range, resolveFirstActivity(source))
      ),
    [source, day, range]
  );
  const scope = focus && <span className='font-normal'>Only {focus.name}, the project in focus</span>;
  const rangeLabel = STATS_RANGES.find((entry) => entry.value === `${range}`)?.label ?? '';
  return (
    <>
      <SettingsGroup title={SHIPPING_SECTION} action={scope} className='gap-1.5'>
        <StatTiles tiles={listShippingTiles(stats, year)} />
        <ShippingGraph year={year} />
        <ShippingChart days={stats.days} aside={rangeLabel} />
      </SettingsGroup>
      <SettingsGroup title={USAGE_SECTION} action={scope} className='gap-1.5'>
        <StatTiles tiles={listUsageTiles(stats)} />
        <UsageChart days={stats.days} />
        <div className='grid gap-1.5 md:grid-cols-3'>
          {listBreakdowns(stats).map((breakdown) => (
            <Breakdown key={breakdown.key} title={breakdown.title} rows={breakdown.rows} />
          ))}
        </div>
        <TopTasks state={state} rows={listTaskRows(stats.tasks)} />
      </SettingsGroup>
    </>
  );
}
