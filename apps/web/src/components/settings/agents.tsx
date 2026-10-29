import type { AccountsSnapshot, AgentProviderInfo, Settings } from '@shinsa/core';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import type * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { SectionChevron } from '@/components/layout/page/section-label.tsx';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { useAgentProviders } from '@/lib/connection/models.ts';
import { createDisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import {
  AGENT_GROUPS,
  type AgentGroup,
  type AgentRoleEntry,
  type AgentSelectLabels,
  CUSTOM_DELEGATION_LIMIT,
  DELEGATION_LIMIT_TITLE,
  describeFollowedRole,
  describeGroupSelects,
  describeRoleSelects,
  FIX_ROUND_ITEMS,
  type FollowingRoleEntry,
  listAgentModelItems,
  listDelegationLimitItems,
  listGroupModelItems,
  listGroupSpeedItems,
  listSpeedItems,
  listWatchdogSettingItems,
  MERGE_ITEMS,
  MIXED_VALUE,
  MODELS_TITLE,
  PLAN_ITEMS,
  parseDelegationLimit,
  parseFixRounds,
  resolveAgentModelPatch,
  resolveAgentModelValue,
  resolveAgentSpeedPatch,
  resolveDelegationLimitValue,
  resolveFixRoundValue,
  resolveGroupModel,
  resolveGroupModelPatch,
  resolveGroupSpeed,
  resolveGroupSpeedPatch,
  resolvePlanValue,
  resolveSpeedAvailability,
  resolveSpeedValue,
  resolveWatchdogSettingValue,
  type SettingItem,
  updateSettings,
  WATCHDOG_SETTING_FIELDS,
  WATCHDOG_SETTINGS_TITLE,
} from '@/lib/settings.ts';
import { DelegationLimitDialog } from './delegation-limit-dialog.tsx';
import { SETTING_ROW, SETTINGS_SHELF, SettingRow, SettingsGroup } from './group.tsx';

type SettingsUpdate = (patch: Partial<Settings>) => void;

interface ModelsContext {
  settings: Settings;
  providers: AgentProviderInfo[];
  accounts: AccountsSnapshot | null;
  update: SettingsUpdate;
}

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

function DescribedRow({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex min-w-0 items-center gap-1.5 text-fg-4 text-xs'>{title}</div>
        <p className='text-2xs text-fg-2'>{description}</p>
      </div>
      <div className='flex shrink-0 items-center gap-1.5'>{children}</div>
    </div>
  );
}

function RoleRow({ context, entry }: { context: ModelsContext; entry: AgentRoleEntry }) {
  const { settings, providers, accounts, update } = context;
  const { role } = entry;
  const model = resolveAgentModelValue(settings, role);
  const availability = resolveSpeedAvailability(accounts, settings, [role]);
  return (
    <DescribedRow title={<span className='truncate'>{entry.title}</span>} description={entry.description}>
      <AgentSelects
        variant='ghost'
        labels={describeRoleSelects(entry)}
        modelItems={listAgentModelItems(providers, model)}
        model={model}
        speedItems={listSpeedItems(availability)}
        speed={resolveSpeedValue(settings, role, availability)}
        onModel={(next) => update(resolveAgentModelPatch(settings, role, next))}
        onSpeed={(next) => update(resolveAgentSpeedPatch(settings, role, next))}
      />
    </DescribedRow>
  );
}

function FollowingRoleRow({ entry }: { entry: FollowingRoleEntry }) {
  return (
    <DescribedRow title={<span className='truncate'>{entry.title}</span>} description={entry.description}>
      <span className='w-71.5 truncate ps-2.5 text-fg-2 text-xs'>{describeFollowedRole(entry)}</span>
    </DescribedRow>
  );
}

function RolesToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type='button'
      aria-expanded={open}
      onClick={onToggle}
      className='flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-control-sm text-2xs text-fg-2 outline-none hover:text-fg-4 active:text-fg-4'
    >
      Per role
      <SectionChevron open={open} />
    </button>
  );
}

function AgentGroupBlock({ context, group }: { context: ModelsContext; group: AgentGroup }) {
  const { settings, providers, accounts, update } = context;
  const model = resolveGroupModel(settings, group);
  const availability = resolveSpeedAvailability(
    accounts,
    settings,
    group.roles.map(({ role }) => role)
  );
  const speed = resolveGroupSpeed(settings, group, availability);
  const roles = useDisclosure(
    createDisclosureId('settings', 'agents', 'group', group.id, 'roles'),
    model === MIXED_VALUE || speed === MIXED_VALUE
  );
  const apply = (patch: Partial<Settings> | null) => {
    if (patch) update(patch);
  };
  return (
    <div className='flex flex-col'>
      <DescribedRow
        title={
          <>
            <span className='truncate'>{group.title}</span>
            <RolesToggle open={roles.open} onToggle={roles.toggle} />
          </>
        }
        description={group.description}
      >
        <AgentSelects
          labels={describeGroupSelects(group)}
          modelItems={listGroupModelItems(providers, settings, group)}
          model={model}
          speedItems={listGroupSpeedItems(settings, group, availability)}
          speed={speed}
          onModel={(next) => apply(resolveGroupModelPatch(settings, group, next))}
          onSpeed={(next) => apply(resolveGroupSpeedPatch(settings, group, next))}
        />
      </DescribedRow>
      {roles.open && (
        <div className={SETTINGS_SHELF}>
          {group.roles.map((entry) => (
            <RoleRow key={entry.role} context={context} entry={entry} />
          ))}
          {group.following.map((entry) => (
            <FollowingRoleRow key={entry.role} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ModelsGroup(context: ModelsContext) {
  return (
    <SettingsGroup title={MODELS_TITLE} className='gap-1.5'>
      {AGENT_GROUPS.map((group) => (
        <AgentGroupBlock key={group.id} context={context} group={group} />
      ))}
    </SettingsGroup>
  );
}

function DelegationLimitField({ settings }: { settings: Settings }) {
  const choosing = useDialogState<'custom'>();
  return (
    <>
      <SelectField
        label={DELEGATION_LIMIT_TITLE}
        items={listDelegationLimitItems(settings)}
        value={resolveDelegationLimitValue(settings)}
        onValueChange={(value) => {
          if (value === CUSTOM_DELEGATION_LIMIT) choosing.show('custom');
          else void updateSettings({ delegationLimit: parseDelegationLimit(value) });
        }}
      />
      {choosing.value && (
        <DelegationLimitDialog
          control={choosing.control}
          initial={settings.delegationLimit ?? null}
          onSave={(delegationLimit) => updateSettings({ delegationLimit })}
        />
      )}
    </>
  );
}

export function AgentSettings({ settings }: { settings: Settings }) {
  const providers = useAgentProviders();
  const accounts = useAccounts();
  return (
    <>
      <ModelsGroup
        settings={settings}
        providers={providers}
        accounts={accounts}
        update={(patch) => void updateSettings(patch)}
      />
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
        <SettingRow title={DELEGATION_LIMIT_TITLE}>
          <DelegationLimitField settings={settings} />
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
      <SettingsGroup title={WATCHDOG_SETTINGS_TITLE}>
        {WATCHDOG_SETTING_FIELDS.map((field) => (
          <SettingRow key={field.key} title={field.title}>
            <SelectField
              label={field.title}
              items={listWatchdogSettingItems(field, settings)}
              value={resolveWatchdogSettingValue(field, settings)}
              onValueChange={(value) => void updateSettings({ [field.key]: Number(value) })}
            />
          </SettingRow>
        ))}
      </SettingsGroup>
    </>
  );
}
