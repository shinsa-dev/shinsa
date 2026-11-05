import type { AutoShipPolicy, Settings } from '@shinsa/core';
import { SelectField } from '@/components/controls/select-field.tsx';
import {
  AUTO_SHIP_DESCRIPTION,
  AUTO_SHIP_ENABLED_ITEMS,
  AUTO_SHIP_MERGE_ITEMS,
  AUTO_SHIP_RISK_ITEMS,
  AUTO_SHIP_TITLE,
  AUTO_SHIP_URGENT_ITEMS,
  listAutoShipWaitItems,
  resolveAutoShipValue,
} from '@/lib/auto-ship.ts';
import { updateSettings } from '@/lib/settings.ts';
import { SettingRow, SettingsGroup } from './group.tsx';

export function AutoShipSettings({ settings }: { settings: Settings }) {
  const { policy, enabled } = resolveAutoShipValue(settings);
  const updateAutoShip = (patch: Partial<AutoShipPolicy>) => {
    void updateSettings({ autoShip: { ...policy, ...patch } });
  };
  return (
    <SettingsGroup title={AUTO_SHIP_TITLE} description={AUTO_SHIP_DESCRIPTION}>
      <SettingRow title='Auto-ship'>
        <SelectField
          label='Auto-ship'
          items={AUTO_SHIP_ENABLED_ITEMS}
          value={enabled}
          onValueChange={(value) => updateAutoShip({ enabled: value === 'on' })}
        />
      </SettingRow>
      {policy.enabled && (
        <>
          <SettingRow title='Approve the review for you'>
            <SelectField
              label='Approve the review for you'
              items={AUTO_SHIP_RISK_ITEMS}
              value={policy.approveUpTo}
              onValueChange={(approveUpTo) => updateAutoShip({ approveUpTo })}
            />
          </SettingRow>
          <SettingRow title='Approve an urgent review for you'>
            <SelectField
              label='Approve an urgent review for you'
              items={AUTO_SHIP_RISK_ITEMS}
              value={policy.urgentApproveUpTo}
              onValueChange={(urgentApproveUpTo) => updateAutoShip({ urgentApproveUpTo })}
            />
          </SettingRow>
          <SettingRow title='Merge for you'>
            <SelectField
              label='Merge for you'
              items={AUTO_SHIP_MERGE_ITEMS}
              value={policy.merge}
              onValueChange={(merge) => updateAutoShip({ merge })}
            />
          </SettingRow>
          <SettingRow title='When an urgent merge waits'>
            <SelectField
              label='When an urgent merge waits'
              items={AUTO_SHIP_URGENT_ITEMS}
              value={policy.urgent}
              onValueChange={(urgent) => updateAutoShip({ urgent })}
            />
          </SettingRow>
          {policy.urgent !== 'wait' && (
            <SettingRow title='Wait before acting'>
              <SelectField
                label='Wait before acting'
                items={listAutoShipWaitItems(policy)}
                value={String(policy.urgentWaitMinutes)}
                onValueChange={(value) => updateAutoShip({ urgentWaitMinutes: Number(value) })}
              />
            </SettingRow>
          )}
        </>
      )}
    </SettingsGroup>
  );
}
