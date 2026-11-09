import { MINUTE_MS, resolveAutoPace, type ShinsaState } from '@shinsa/core';
import { Switch } from '@shinsa/ui/components/switch';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { useMinute } from '@/hooks/use-minute.ts';
import { AUTO_PACE_LABEL, selectPaceBudget } from '@/lib/accounts/auto-pace.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import { SETTING_ROW, SettingRow, SettingsEmpty } from './group.tsx';

export function AutoPaceToggle({ state }: { state: ShinsaState }) {
  const available = useEngineFeature('usage.auto_pace');
  if (!available) return null;
  const on = resolveAutoPace(state.settings);
  return (
    <>
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
      <SettingsEmpty>{on ? AUTO_PACE_LABEL.on : AUTO_PACE_LABEL.off}</SettingsEmpty>
    </>
  );
}

export function PaceBudget({
  state,
  provider,
  safePace,
}: {
  state: ShinsaState;
  provider: string;
  safePace: number;
}) {
  const available = useEngineFeature('usage.auto_pace');
  const minute = useMinute();
  const row = React.useMemo(
    () => selectPaceBudget(state, provider, minute * MINUTE_MS, safePace),
    [state, provider, minute, safePace]
  );
  if (!available || !resolveAutoPace(state.settings)) return null;
  if (!row) return <SettingsEmpty>{AUTO_PACE_LABEL.noPace}</SettingsEmpty>;
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
