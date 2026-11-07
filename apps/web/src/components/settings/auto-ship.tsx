import type { AutoShipPolicy, Settings } from '@shinsa/core';
import type * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import {
  AUTO_SHIP_DESCRIPTION,
  AUTO_SHIP_ENABLED_ITEMS,
  AUTO_SHIP_MERGE_ITEMS,
  AUTO_SHIP_NO_TEAM,
  AUTO_SHIP_RISK_ITEMS,
  AUTO_SHIP_TITLE,
  AUTO_SHIP_URGENT_ITEMS,
  isEscalationUnseen,
  listAutoShipWaitItems,
  resolveAutoShipValue,
} from '@/lib/auto-ship.ts';
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import { DescribedRow, SettingRow, SettingsGroup } from './group.tsx';

const URGENT_TITLE = 'When an urgent merge waits';

function UrgentRow({ description, children }: { description: string | null; children: React.ReactNode }) {
  if (description === null) return <SettingRow title={URGENT_TITLE}>{children}</SettingRow>;
  return (
    <DescribedRow title={URGENT_TITLE} description={description}>
      {children}
    </DescribedRow>
  );
}

export function AutoShipSettings({ settings }: { settings: Settings }) {
  const available = useEngineFeature('auto_ship');
  const projects = useShinsaSelector((state) => state.projects);
  const { policy, enabled } = resolveAutoShipValue(settings);
  if (!available) return null;
  const unseen = isEscalationUnseen(policy, Object.values(projects ?? {}));
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
          <UrgentRow description={unseen ? AUTO_SHIP_NO_TEAM : null}>
            <SelectField
              label='When an urgent merge waits'
              items={AUTO_SHIP_URGENT_ITEMS}
              value={policy.urgent}
              onValueChange={(urgent) => updateAutoShip({ urgent })}
            />
          </UrgentRow>
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
