import type { AutopilotPolicy, Settings } from '@shinsa/core';
import { SelectField } from '@/components/controls/select-field.tsx';
import {
  AUTOPILOT_DESCRIPTION,
  AUTOPILOT_ENABLED_ITEMS,
  AUTOPILOT_MERGE_ITEMS,
  AUTOPILOT_NO_TEAM,
  AUTOPILOT_RISK_ITEMS,
  AUTOPILOT_ROWS,
  AUTOPILOT_TITLE,
  AUTOPILOT_URGENT_ITEMS,
  AUTOPILOT_USAGE_ITEMS,
  isEscalationUnseen,
  listAutopilotWaitItems,
  resolveAutopilotValue,
} from '@/lib/autopilot.ts';
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import { DescribedRow, SettingRow, SettingsGroup } from './group.tsx';

export function AutopilotSettings({ settings }: { settings: Settings }) {
  const available = useEngineFeature('autopilot');
  const projects = useShinsaSelector((state) => state.projects);
  const { policy, enabled } = resolveAutopilotValue(settings);
  if (!available) return null;
  const unseen = isEscalationUnseen(policy, Object.values(projects ?? {}));
  const updateAutopilot = (patch: Partial<AutopilotPolicy>) => {
    void updateSettings({ autopilot: { ...policy, ...patch } });
  };
  return (
    <SettingsGroup title={AUTOPILOT_TITLE} description={AUTOPILOT_DESCRIPTION}>
      <SettingRow title='Autopilot'>
        <SelectField
          label='Autopilot'
          items={AUTOPILOT_ENABLED_ITEMS}
          value={enabled}
          onValueChange={(value) => updateAutopilot({ enabled: value === 'on' })}
        />
      </SettingRow>
      {policy.enabled && (
        <>
          <DescribedRow title={AUTOPILOT_ROWS.approve.title} description={AUTOPILOT_ROWS.approve.description}>
            <SelectField
              label={AUTOPILOT_ROWS.approve.title}
              items={AUTOPILOT_RISK_ITEMS}
              value={policy.approveUpTo}
              onValueChange={(approveUpTo) => updateAutopilot({ approveUpTo })}
            />
          </DescribedRow>
          <DescribedRow
            title={AUTOPILOT_ROWS.urgentApprove.title}
            description={AUTOPILOT_ROWS.urgentApprove.description}
          >
            <SelectField
              label={AUTOPILOT_ROWS.urgentApprove.title}
              items={AUTOPILOT_RISK_ITEMS}
              value={policy.urgentApproveUpTo}
              onValueChange={(urgentApproveUpTo) => updateAutopilot({ urgentApproveUpTo })}
            />
          </DescribedRow>
          <DescribedRow title={AUTOPILOT_ROWS.merge.title} description={AUTOPILOT_ROWS.merge.description}>
            <SelectField
              label={AUTOPILOT_ROWS.merge.title}
              items={AUTOPILOT_MERGE_ITEMS}
              value={policy.merge}
              onValueChange={(merge) => updateAutopilot({ merge })}
            />
          </DescribedRow>
          <DescribedRow
            title={AUTOPILOT_ROWS.urgent.title}
            description={unseen ? AUTOPILOT_NO_TEAM : AUTOPILOT_ROWS.urgent.description}
          >
            <SelectField
              label={AUTOPILOT_ROWS.urgent.title}
              items={AUTOPILOT_URGENT_ITEMS}
              value={policy.urgent}
              onValueChange={(urgent) => updateAutopilot({ urgent })}
            />
          </DescribedRow>
          {policy.urgent !== 'wait' && (
            <DescribedRow title={AUTOPILOT_ROWS.wait.title} description={AUTOPILOT_ROWS.wait.description}>
              <SelectField
                label={AUTOPILOT_ROWS.wait.title}
                items={listAutopilotWaitItems(policy)}
                value={String(policy.urgentWaitMinutes)}
                onValueChange={(value) => updateAutopilot({ urgentWaitMinutes: Number(value) })}
              />
            </DescribedRow>
          )}
          <DescribedRow title={AUTOPILOT_ROWS.usage.title} description={AUTOPILOT_ROWS.usage.description}>
            <SelectField
              label={AUTOPILOT_ROWS.usage.title}
              items={AUTOPILOT_USAGE_ITEMS}
              value={policy.ignoreUsageLimits ? 'on' : 'off'}
              onValueChange={(value) => updateAutopilot({ ignoreUsageLimits: value === 'on' })}
            />
          </DescribedRow>
        </>
      )}
    </SettingsGroup>
  );
}
