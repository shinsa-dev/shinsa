import {
  type ActiveDay,
  type ActiveHours,
  MINUTE_MS,
  resolveActiveHours,
  type ShinsaState,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { useMinute } from '@/hooks/use-minute.ts';
import {
  ACTIVE_HOURS_AXIS,
  ACTIVE_HOURS_LABEL,
  ACTIVE_HOURS_LEGEND,
  type ActiveHourRow,
  describeActiveHoursSource,
  describeNow,
  describeWeekTotal,
  formatHour,
  listActiveHourRows,
  listFromItems,
  listToItems,
  readFromValue,
  resolveNowMark,
  resolveFromValue,
  resolveOverrideDays,
  updateOverrideDay,
} from '@/lib/active-hours.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import {
  ROW_INSET,
  SETTING_ROW,
  SETTING_ROW_WRAPS,
  SettingsBlock,
  SettingsEmpty,
  SettingsGroup,
  TOKEN_TEXT,
} from './group.tsx';

const LANE_LABEL = 'w-24 shrink-0 sm:w-36';

const LEGEND_SWATCH = {
  active: 'h-2 w-3 rounded-xs bg-primary/50',
  away: 'h-2 w-3 rounded-xs bg-bg-a2',
  now: 'h-2.5 w-0 border-l border-dashed border-amber-4',
} as const;

function Lane({ row, now }: { row: ActiveHourRow; now: number | null }) {
  return (
    <div className='flex items-center gap-3'>
      <span className={cn(LANE_LABEL, 'text-2xs text-fg-3')}>{row.name}</span>
      <div data-day={row.name} className='relative h-3 min-w-0 flex-1 rounded-xs bg-bg-a2'>
        {row.runs.map((run) => (
          <Hint key={run.from} label={run.label}>
            <span
              data-run={`${run.from}-${run.to}`}
              className='absolute inset-y-0 rounded-xs bg-primary/50'
              style={{ left: `${run.start * 100}%`, width: `${run.width * 100}%` }}
            />
          </Hint>
        ))}
        {now !== null && (
          <span
            aria-hidden
            data-now
            className='absolute -inset-y-1 border-l border-dashed border-amber-4'
            style={{ left: `${now * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

function HourAxis() {
  return (
    <div className='flex gap-3'>
      <span className={LANE_LABEL} />
      <div aria-hidden className='relative h-4 min-w-0 flex-1 text-2xs text-fg-2'>
        {ACTIVE_HOURS_AXIS.map((tick) => (
          <span
            key={tick.hour}
            className={cn(
              'absolute top-0 whitespace-nowrap',
              tick.share === 0 ? '' : tick.share === 1 ? '-translate-x-full' : '-translate-x-1/2'
            )}
            style={{ left: `${tick.share * 100}%` }}
          >
            {formatHour(tick.hour)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className='flex gap-3'>
      <span className={cn(LANE_LABEL, 'max-sm:hidden')} />
      <ul className='flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-2'>
        {ACTIVE_HOURS_LEGEND.map((item) => (
          <li key={item.key} className='flex items-center gap-1.5'>
            <span aria-hidden className={LEGEND_SWATCH[item.key]} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Week({ rows, hours, now }: { rows: ActiveHourRow[]; hours: ActiveHours; now: number }) {
  const mark = resolveNowMark(hours, now);
  return (
    <div className={cn('flex flex-col gap-1.5 py-2.5', ROW_INSET)}>
      {rows.map((row) => (
        <Lane key={row.weekday} row={row} now={row.weekday === mark.weekday ? mark.share : null} />
      ))}
      <HourAxis />
      <Legend />
    </div>
  );
}

function OverrideFields({
  row,
  days,
  onChange,
}: {
  row: ActiveHourRow;
  days: readonly ActiveDay[];
  onChange: (days: ActiveDay[]) => void;
}) {
  const fromLabel = `${row.name} starts`;
  const toLabel = `${row.name} ends`;
  return (
    <div className='flex shrink-0 items-center gap-1.5'>
      <SelectField
        label={fromLabel}
        size='sm'
        items={listFromItems()}
        value={resolveFromValue(row.span)}
        onValueChange={(value) =>
          onChange(updateOverrideDay(days, row.weekday, readFromValue(value, row.span)))
        }
      />
      {row.span && (
        <SelectField
          label={toLabel}
          size='sm'
          items={listToItems(row.span.from)}
          value={String(row.span.to)}
          onValueChange={(value) =>
            onChange(updateOverrideDay(days, row.weekday, { from: row.span?.from ?? 0, to: Number(value) }))
          }
        />
      )}
    </div>
  );
}

export function ActiveHoursSettings({ state }: { state: ShinsaState }) {
  const available = useEngineFeature('active-hours');
  const minute = useMinute();
  const hours = React.useMemo(() => resolveActiveHours(state, minute * MINUTE_MS), [state, minute]);
  if (!available) return null;
  const override = state.settings.activeHours ?? null;
  const saveOverride = (activeHours: ActiveDay[]) => void updateSettings({ activeHours });
  const action = override ? (
    <Button
      variant='secondary'
      size='sm'
      icon='IconCalenderSparkle'
      onClick={() => void updateSettings({ activeHours: null }, ACTIVE_HOURS_LABEL.saved.learned)}
    >
      {ACTIVE_HOURS_LABEL.useLearned}
    </Button>
  ) : (
    <Button
      variant='secondary'
      size='sm'
      icon='IconPencil'
      onClick={() =>
        void updateSettings({ activeHours: resolveOverrideDays(hours) }, ACTIVE_HOURS_LABEL.saved.override)
      }
    >
      {ACTIVE_HOURS_LABEL.setByHand}
    </Button>
  );
  const rows = hours ? listActiveHourRows(hours, override) : [];
  const now = minute * MINUTE_MS;
  return (
    <SettingsGroup
      title={ACTIVE_HOURS_LABEL.title}
      description={ACTIVE_HOURS_LABEL.description}
      action={action}
    >
      {!hours && <SettingsEmpty>{ACTIVE_HOURS_LABEL.learning}</SettingsEmpty>}
      {hours && (
        <SettingsBlock
          header={
            <div className='flex min-w-0 flex-1 items-center gap-1.5 text-xs'>
              <span className='font-medium text-fg-4'>{ACTIVE_HOURS_LEGEND[0].label}</span>
              <span className='shrink-0 text-fg-2 tabular-nums'>{describeWeekTotal(hours)}</span>
            </div>
          }
        >
          <div className={SETTING_ROW}>
            <span className='min-w-0 flex-1 text-xs text-fg-4'>{describeNow(hours, now)}</span>
          </div>
          <Week rows={rows} hours={hours} now={now} />
          <div className={SETTING_ROW}>
            <span className='min-w-0 flex-1 text-xs text-fg-2'>{describeActiveHoursSource(hours)}</span>
          </div>
        </SettingsBlock>
      )}
      {hours && override && (
        <SettingsBlock
          header={<span className='text-xs font-medium text-fg-4'>{ACTIVE_HOURS_LABEL.byHand}</span>}
        >
          {rows.map((row) => (
            <div key={row.weekday} className={cn(SETTING_ROW, SETTING_ROW_WRAPS)}>
              <span className='min-w-0 flex-1 text-xs text-fg-4'>{row.name}</span>
              {row.split ? (
                <span title={ACTIVE_HOURS_LABEL.split} className={cn(TOKEN_TEXT, 'truncate')}>
                  {row.ranges}
                </span>
              ) : (
                <OverrideFields row={row} days={override} onChange={saveOverride} />
              )}
            </div>
          ))}
        </SettingsBlock>
      )}
    </SettingsGroup>
  );
}
