import {
  type ForecastTimeline,
  MINUTE_MS,
  resolveForecastTimeline,
  type ShinsaState,
  type UsageForecast,
} from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Choice } from '@/components/controls/choice.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { useMinute } from '@/hooks/use-minute.ts';
import {
  describeOutage,
  describeOutages,
  describeRecentPace,
  describeSafePace,
  describeSegment,
  describeTightest,
  FORECAST_TITLE,
  type ForecastPaceChoice,
  type ForecastLane,
  formatForecastDay,
  formatPace,
  listForecastDays,
  listForecastLanes,
  listForecastPaces,
  listOutageSpans,
  listProviderForecasts,
  type ProviderForecast,
  FORECAST_LEGEND,
  resolveDefaultPace,
  resolveForecastShare,
  resolveUsableShare,
  selectForecastPace,
} from '@/lib/accounts/forecast.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { ROW_INSET, SETTING_ROW, SettingsBlock, SettingsGroup } from './group.tsx';

const LANE_LABEL = 'w-24 shrink-0 sm:w-36';

const RESET_GAP = '2px';

function Lane({ forecast, lane }: { forecast: UsageForecast; lane: ForecastLane }) {
  return (
    <div className='flex items-center gap-3'>
      <Truncate className={cn(LANE_LABEL, 'text-2xs text-fg-3')}>{lane.account.label}</Truncate>
      <div className='relative h-3 min-w-0 flex-1'>
        {lane.segments.map((segment) => {
          const start = resolveForecastShare(forecast, segment.from);
          const end = resolveForecastShare(forecast, segment.to);
          const afterReset = segment.from > forecast.from;
          const gap = afterReset ? RESET_GAP : '0px';
          return (
            <Hint key={segment.from} label={describeSegment(forecast, segment, forecast.from)}>
              <span
                data-usable={resolveUsableShare(segment)}
                data-reset-gap={afterReset || undefined}
                className='absolute inset-y-0 overflow-hidden rounded-xs bg-bg-a2'
                style={{
                  left: `calc(${start * 100}% + ${gap})`,
                  width: `calc(${(end - start) * 100}% - ${gap})`,
                }}
              >
                <span
                  className='absolute inset-y-0 start-0 bg-primary/50'
                  style={{ width: `${resolveUsableShare(segment) * 100}%` }}
                />
              </span>
            </Hint>
          );
        })}
      </div>
    </div>
  );
}

const LEGEND_SWATCH = {
  usable: 'h-2 w-3 rounded-xs bg-primary/50',
  empty: 'h-2 w-3 rounded-xs bg-bg-a2',
  outage:
    'h-2 w-3 rounded-xs border border-dashed border-orange-4 bg-[repeating-linear-gradient(135deg,var(--color-orange-a3)_0_1px,transparent_1px_5px)]',
  tightest: 'h-2.5 w-0 border-l border-dashed border-amber-4',
} as const;

function Legend() {
  return (
    <div className='flex gap-3'>
      <span className={cn(LANE_LABEL, 'max-sm:hidden')} />
      <ul className='flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-2'>
        {FORECAST_LEGEND.map((item) => (
          <li key={item.key} className='flex items-center gap-1.5'>
            <span aria-hidden className={LEGEND_SWATCH[item.key]} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Outages({ forecast, timeline }: { forecast: UsageForecast; timeline: ForecastTimeline }) {
  return listOutageSpans(forecast, timeline.outages).map((span) => (
    <Hint key={span.at} label={describeOutage(span.outage, forecast.from)}>
      <span
        data-outage
        className='pointer-events-auto absolute -inset-y-1 rounded-xs border border-dashed border-orange-4 bg-[repeating-linear-gradient(135deg,var(--color-orange-a3)_0_1px,transparent_1px_5px)]'
        style={{ left: `${span.start * 100}%`, width: `${span.width * 100}%` }}
      />
    </Hint>
  ));
}

function TightestMark({ forecast }: { forecast: UsageForecast }) {
  if (!forecast.tightest) return null;
  return (
    <span
      aria-hidden
      data-tightest
      className='absolute -inset-y-1 border-l border-dashed border-amber-4'
      style={{ left: `${resolveForecastShare(forecast, forecast.tightest.at) * 100}%` }}
    />
  );
}

function DayAxis({ forecast }: { forecast: UsageForecast }) {
  return (
    <div className='flex gap-3'>
      <span className={LANE_LABEL} />
      <div aria-hidden className='relative h-4 min-w-0 flex-1 text-2xs text-fg-2'>
        {listForecastDays(forecast).map((day) => (
          <span
            key={day.at}
            className='absolute top-0 -translate-x-1/2 whitespace-nowrap'
            style={{ left: `${day.share * 100}%` }}
          >
            {formatForecastDay(day.at)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Timeline({ forecast, timeline }: { forecast: UsageForecast; timeline: ForecastTimeline }) {
  const lanes = listForecastLanes(forecast, timeline);
  const atSafePace = timeline.pace === forecast.safePace;
  return (
    <div className={cn('flex flex-col gap-1.5 py-2.5', ROW_INSET)}>
      <div className='relative flex flex-col gap-1.5'>
        <div
          data-overlay
          className='pointer-events-none absolute inset-y-0 right-0 left-[calc(--spacing(24)+--spacing(3))] z-10 sm:left-[calc(--spacing(36)+--spacing(3))]'
        >
          <Outages forecast={forecast} timeline={timeline} />
          {atSafePace && timeline.outages.length === 0 && <TightestMark forecast={forecast} />}
        </div>
        {lanes.map((lane) => (
          <Lane key={lane.account.id} forecast={forecast} lane={lane} />
        ))}
      </div>
      <DayAxis forecast={forecast} />
      <Legend />
    </div>
  );
}

function ForecastBlock({ entry }: { entry: ProviderForecast }) {
  const { forecast } = entry;
  const [choice, setChoice] = React.useState<ForecastPaceChoice>(() => resolveDefaultPace(forecast));
  const paces = listForecastPaces(forecast);
  const chosen = selectForecastPace(forecast, choice);
  const timeline = React.useMemo(
    () => resolveForecastTimeline(forecast, chosen.pace),
    [forecast, chosen.pace]
  );
  const tightest = describeTightest(forecast, forecast.from);
  const outages = describeOutages(timeline, forecast.from);
  return (
    <SettingsBlock
      header={
        <div className='flex min-w-0 flex-1 items-center gap-1.5 text-xs'>
          <span className='font-medium text-fg-4'>{entry.title}</span>
          <span className='shrink-0 text-fg-2 tabular-nums'>{formatPace(forecast.safePace)} a day</span>
        </div>
      }
    >
      <div className={SETTING_ROW}>
        <span className='min-w-0 flex-1 text-xs text-fg-4'>{describeSafePace(forecast)}</span>
      </div>
      {paces.length > 1 && (
        <div className={cn(SETTING_ROW, 'flex-wrap gap-y-1.5')}>
          <span className='min-w-0 flex-1 text-xs text-fg-2'>Timeline at</span>
          <Choice<ForecastPaceChoice>
            label='Timeline pace'
            items={paces}
            value={chosen.value}
            onValueChange={setChoice}
          />
        </div>
      )}
      <Timeline forecast={forecast} timeline={timeline} />
      {outages && (
        <div className={SETTING_ROW}>
          <span className='min-w-0 flex-1 text-xs text-fg-4'>{outages}</span>
        </div>
      )}
      {tightest && (
        <div className={SETTING_ROW}>
          <span className='min-w-0 flex-1 text-xs text-fg-2'>{tightest}</span>
        </div>
      )}
      <div className={SETTING_ROW}>
        <span className='min-w-0 flex-1 text-xs text-fg-2'>
          {describeRecentPace(forecast, forecast.from)}
        </span>
      </div>
    </SettingsBlock>
  );
}

export function ForecastSettings({ state }: { state: ShinsaState }) {
  const snapshot = useAccounts();
  const minute = useMinute();
  const forecasts = React.useMemo(
    () => listProviderForecasts(snapshot, state, minute * MINUTE_MS),
    [snapshot, state, minute]
  );
  if (forecasts.length === 0) return null;
  return (
    <SettingsGroup
      title={FORECAST_TITLE}
      description='The highest steady pace your accounts can keep up for the next 7 days, spending first from the account that resets soonest.'
    >
      {forecasts.map((entry) => (
        <ForecastBlock key={entry.provider} entry={entry} />
      ))}
    </SettingsGroup>
  );
}
