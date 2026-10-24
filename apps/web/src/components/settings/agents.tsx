import type { AccountsSnapshot, AgentProviderInfo, Settings } from '@shinsa/core';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { SectionChevron } from '@/components/layout/page/section-label.tsx';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { useAgentProviders } from '@/lib/connection/models.ts';
import {
  AGENT_GROUPS,
  type AgentGroup,
  type AgentRoleEntry,
  type AgentSelectLabels,
  changeAgentModel,
  changeAgentSpeed,
  changeGroupModel,
  changeGroupSpeed,
  describeGroupSelects,
  describeRoleSelects,
  FIX_ROUND_ITEMS,
  listAgentModelItems,
  listGroupModelItems,
  listGroupSpeedItems,
  listSpeedItems,
  MERGE_ITEMS,
  MIXED_VALUE,
  PLAN_ITEMS,
  parseFixRounds,
  resolveAgentModelValue,
  resolveFixRoundValue,
  resolveGroupModel,
  resolveGroupSpeed,
  resolvePlanValue,
  resolveSpeedAvailability,
  resolveSpeedValue,
  type SettingItem,
  updateSettings,
} from '@/lib/settings.ts';
import { SETTINGS_SHELF, SettingRow, SettingsGroup } from './group.tsx';

function AgentSelects({
  labels,
  modelItems,
  model,
  speedItems,
  speed,
  onModel,
  onSpeed,
  variant = 'default',
}: {
  labels: AgentSelectLabels;
  modelItems: SettingItem<string>[];
  model: string;
  speedItems: SettingItem<string>[];
  speed: string;
  onModel: (model: string) => void;
  onSpeed: (speed: string) => void;
  variant?: 'default' | 'ghost';
}) {
  return (
    <>
      <SelectField
        variant={variant}
        label={labels.model}
        items={modelItems}
        value={model}
        onValueChange={onModel}
        className='w-40'
      />
      <SelectField
        variant={variant}
        label={labels.speed}
        items={speedItems}
        value={speed}
        onValueChange={onSpeed}
        className='w-30'
      />
    </>
  );
}

function RoleRow({
  settings,
  providers,
  accounts,
  entry,
}: {
  settings: Settings;
  providers: AgentProviderInfo[];
  accounts: AccountsSnapshot | null;
  entry: AgentRoleEntry;
}) {
  const { role, title } = entry;
  const model = resolveAgentModelValue(settings, role);
  const availability = resolveSpeedAvailability(accounts, settings, [role]);
  return (
    <SettingRow title={title}>
      <AgentSelects
        variant='ghost'
        labels={describeRoleSelects(entry)}
        modelItems={listAgentModelItems(providers, model)}
        model={model}
        speedItems={listSpeedItems(availability)}
        speed={resolveSpeedValue(settings, role, availability)}
        onModel={(next) => void changeAgentModel(settings, role, next)}
        onSpeed={(next) => void changeAgentSpeed(settings, role, next)}
      />
    </SettingRow>
  );
}

function RolesToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type='button'
      aria-expanded={open}
      onClick={onToggle}
      className='flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-control-sm text-2xs text-fg-2 outline-none transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
    >
      Per role
      <SectionChevron open={open} />
    </button>
  );
}

function AgentGroupBlock({
  settings,
  providers,
  accounts,
  group,
}: {
  settings: Settings;
  providers: AgentProviderInfo[];
  accounts: AccountsSnapshot | null;
  group: AgentGroup;
}) {
  const model = resolveGroupModel(settings, group);
  const availability = resolveSpeedAvailability(
    accounts,
    settings,
    group.roles.map(({ role }) => role)
  );
  const speed = resolveGroupSpeed(settings, group, availability);
  const [open, setOpen] = React.useState(model === MIXED_VALUE || speed === MIXED_VALUE);
  const perRole = group.roles.length > 1;
  return (
    <div className='flex flex-col'>
      <SettingRow
        title={
          <>
            <span className='truncate'>{group.title}</span>
            {perRole && <RolesToggle open={open} onToggle={() => setOpen((current) => !current)} />}
          </>
        }
      >
        <AgentSelects
          labels={describeGroupSelects(group)}
          modelItems={listGroupModelItems(providers, settings, group)}
          model={model}
          speedItems={listGroupSpeedItems(settings, group, availability)}
          speed={speed}
          onModel={(next) => void changeGroupModel(settings, group, next)}
          onSpeed={(next) => void changeGroupSpeed(settings, group, next)}
        />
      </SettingRow>
      {perRole && open && (
        <div className={SETTINGS_SHELF}>
          {group.roles.map((entry) => (
            <RoleRow
              key={entry.role}
              settings={settings}
              providers={providers}
              accounts={accounts}
              entry={entry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentSettings({ settings }: { settings: Settings }) {
  const providers = useAgentProviders();
  const accounts = useAccounts();
  return (
    <>
      <SettingsGroup title='Agents' className='gap-1.5'>
        {AGENT_GROUPS.map((group) => (
          <AgentGroupBlock
            key={group.id}
            settings={settings}
            providers={providers}
            accounts={accounts}
            group={group}
          />
        ))}
      </SettingsGroup>
      <SettingsGroup title='Engine'>
        <SettingRow title='Approve plans'>
          <SelectField
            label='Approve plans'
            items={PLAN_ITEMS}
            value={resolvePlanValue(settings)}
            onValueChange={(value) => void updateSettings({ approvePlans: value === 'large' })}
          />
        </SettingRow>
        <SettingRow title='Automatic fix rounds'>
          <SelectField
            label='Automatic fix rounds'
            items={FIX_ROUND_ITEMS}
            value={resolveFixRoundValue(settings)}
            onValueChange={(value) => void updateSettings({ maxFixRounds: parseFixRounds(value) })}
          />
        </SettingRow>
        <SettingRow title='Merge with'>
          <SelectField
            label='Merge with'
            items={MERGE_ITEMS}
            value={settings.mergeMethod}
            onValueChange={(mergeMethod) => void updateSettings({ mergeMethod })}
          />
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
