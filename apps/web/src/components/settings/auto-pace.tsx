import { MINUTE_MS, resolveAutoPace, type ShinsaState } from '@shinsa/core';
import { Switch } from '@shinsa/ui/components/switch';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { useMinute } from '@/hooks/use-minute.ts';
import { AUTO_PACE_LABEL, selectPaceBudget } from '@/lib/accounts/auto-pace.ts';
import { listProviderForecasts } from '@/lib/accounts/forecast.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import { SETTING_ROW, SettingRow, SettingsEmpty, SettingsGroup } from './group.tsx';

function PaceBudgets({ state }: { state: ShinsaState }) {
  const snapshot = useAccounts();
  const minute = useMinute();
  const rows = React.useMemo(() => {
    const now = minute * MINUTE_MS;
    return listProviderForecasts(snapshot, state, now).flatMap((entry) => {
      const row = selectPaceBudget(state, entry.provider, now, entry.forecast.safePace, entry.title);
      return row ? [row] : [];
    });
  }, [snapshot, state, minute]);
  if (rows.length === 0) return <SettingsEmpty>{AUTO_PACE_LABEL.noPace}</SettingsEmpty>;
  return rows.map((row) => (
    <div key={row.provider} className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <Truncate className='text-xs text-fg-4'>{row.label}</Truncate>
        <span className='text-2xs text-fg-2'>{row.detail}</span>
      </div>
      <span className='shrink-0 text-xs text-fg-3 tabular-nums'>{row.value}</span>
    </div>
  ));
}

export function AutoPaceSettings({ state }: { state: ShinsaState }) {
  const available = useEngineFeature('usage.auto_pace');
  if (!available) return null;
  const on = resolveAutoPace(state.settings);
  return (
    <SettingsGroup title={AUTO_PACE_LABEL.title}>
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
      {on && <PaceBudgets state={state} />}
      <SettingsEmpty>{on ? AUTO_PACE_LABEL.on : AUTO_PACE_LABEL.off}</SettingsEmpty>
    </SettingsGroup>
  );
}
