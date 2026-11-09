import { type ActiveDay, MINUTE_MS, resolveActiveHours, type ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { useMinute } from '@/hooks/use-minute.ts';
import {
  ACTIVE_HOURS_LABEL,
  type ActiveHourRow,
  describeActiveHoursSource,
  listActiveHourRows,
  listFromItems,
  listToItems,
  readFromValue,
  resolveFromValue,
  resolveOverrideDays,
  updateOverrideDay,
} from '@/lib/active-hours.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import { SETTING_ROW, SETTING_ROW_WRAPS, SettingsEmpty, SettingsGroup, TOKEN_TEXT } from './group.tsx';

function HourCells({ cells, name }: { cells: ActiveHourRow['cells']; name: string }) {
  return (
    <div aria-hidden data-day={name} className='flex h-3 min-w-24 flex-1 gap-px'>
      {cells.map(({ hour, active }) => (
        <span key={hour} className={cn('flex-1 rounded-xs', active ? 'bg-primary' : 'bg-bg-a3')} />
      ))}
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
  return (
    <SettingsGroup
      title={ACTIVE_HOURS_LABEL.title}
      description={ACTIVE_HOURS_LABEL.description}
      action={action}
    >
      {!hours && <SettingsEmpty>{ACTIVE_HOURS_LABEL.learning}</SettingsEmpty>}
      {hours && (
        <>
          <p className='px-2 pt-1 pb-1.5 text-2xs text-fg-2'>{describeActiveHoursSource(hours)}</p>
          {listActiveHourRows(hours, override).map((row) => (
            <div key={row.weekday} className={cn(SETTING_ROW, SETTING_ROW_WRAPS, 'gap-3')}>
              <span className='w-20 shrink-0 text-xs text-fg-4'>{row.name}</span>
              <HourCells cells={row.cells} name={row.name} />
              {override && !row.split ? (
                <OverrideFields row={row} days={override} onChange={saveOverride} />
              ) : (
                <span
                  title={row.split ? ACTIVE_HOURS_LABEL.split : undefined}
                  className={cn(TOKEN_TEXT, 'w-60 truncate text-right')}
                >
                  {row.ranges}
                </span>
              )}
            </div>
          ))}
        </>
      )}
    </SettingsGroup>
  );
}
