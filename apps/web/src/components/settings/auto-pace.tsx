import { MINUTE_MS, resolveAutoPace, type ShinsaState } from '@shinsa/core';
import { Switch } from '@shinsa/ui/components/switch';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { useMinute } from '@/hooks/use-minute.ts';
import { AUTO_PACE_LABEL, listPaceBudgets, type PaceBudgetRow } from '@/lib/accounts/auto-pace.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import { SETTING_ROW, SettingRow, SettingsEmpty, SettingsGroup } from './group.tsx';

function BudgetRow({ row }: { row: PaceBudgetRow }) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <Truncate className='text-xs text-fg-4'>{row.label}</Truncate>
        <span className='text-2xs text-fg-2'>{row.detail}</span>
      </div>
      <span className='shrink-0 text-xs text-fg-3 tabular-nums'>{row.value}</span>
    </div>
  );
}

export function AutoPaceSettings({ state }: { state: ShinsaState }) {
  const available = useEngineFeature('usage.auto_pace');
  const minute = useMinute();
  const on = resolveAutoPace(state.settings);
  const budgets = React.useMemo(() => listPaceBudgets(state, minute * MINUTE_MS), [state, minute]);
  if (!available) return null;
  return (
    <SettingsGroup title={AUTO_PACE_LABEL.title} description={AUTO_PACE_LABEL.description}>
      <SettingRow title={AUTO_PACE_LABEL.toggle}>
        <Switch
          checked={on}
          aria-label={AUTO_PACE_LABEL.toggle}
          onCheckedChange={(autoPace) =>
            void updateSettings(
              { autoPace },
              autoPace ? AUTO_PACE_LABEL.toggled.on : AUTO_PACE_LABEL.toggled.off
            )
          }
        />
      </SettingRow>
      {on && budgets.map((row) => <BudgetRow key={row.provider} row={row} />)}
      {on && budgets.length === 0 && <SettingsEmpty>{AUTO_PACE_LABEL.noPace}</SettingsEmpty>}
    </SettingsGroup>
  );
}
