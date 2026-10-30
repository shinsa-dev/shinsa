import type { AccountUsage, Settings, UsageRate } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { PercentDialog } from '@/components/accounts/percent-dialog.tsx';
import { ResetTime, UsageBar } from '@/components/accounts/usage-bar.tsx';
import { UsagePercent } from '@/components/accounts/usage-percent.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import {
  listSwitchItems,
  needsSnoozeSetting,
  OTHER_PERCENT,
  RESUME_ITEMS,
  resolveResumeValue,
  resolveSnoozeValue,
  resolveSwitchValue,
  SNOOZE_ITEMS,
  SNOOZE_TITLE,
} from '@/lib/accounts/limits.ts';
import { describeUsageDetail, listUsageRows, type UsageRow } from '@/lib/accounts/usage.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import {
  COST_LIMIT_TITLE,
  describeUsageLimitNote,
  listBudgetItems,
  listUsageLimitItems,
  needsCostLimit,
  parseBudget,
  parseUsageLimit,
  resolveBudgetValue,
  resolveUsageLimitValue,
  USAGE_LIMIT_TITLE,
  updateSettings,
} from '@/lib/settings.ts';
import { SETTING_ROW, SettingRow, SettingsEmpty, SettingsGroup } from './group.tsx';

function WindowRow({ row }: { row: UsageRow }) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col gap-px'>
        <Truncate className='text-fg-4 text-xs'>{row.label}</Truncate>
        {row.resetsAt !== null && (
          <span className='text-2xs text-fg-2'>
            <ResetTime at={row.resetsAt} />
          </span>
        )}
      </div>
      <UsageBar row={row} className='w-24 shrink-0 sm:w-40' />
      <UsagePercent percent={row.percent} className='w-9 text-right' />
    </div>
  );
}

function DetailRow({ text }: { text: string }) {
  return (
    <div className={SETTING_ROW}>
      <span className='min-w-0 flex-1 text-fg-2 text-xs'>{text}</span>
    </div>
  );
}

export function UsageWindows({ account }: { account: { usage: AccountUsage } }) {
  const rows = listUsageRows(account);
  if (rows.length === 0) return <DetailRow text={describeUsageDetail(account)} />;
  return rows.map((row) => <WindowRow key={row.id} row={row} />);
}

function SwitchAtField({ settings }: { settings: Settings }) {
  const choosing = useDialogState<'other'>();
  return (
    <>
      <SelectField
        label={ACCOUNT_LABEL.switchAt}
        items={listSwitchItems(settings)}
        value={resolveSwitchValue(settings)}
        onValueChange={(value) => {
          if (value === OTHER_PERCENT) choosing.show('other');
          else void updateSettings({ accountSwitchAt: Number(value) });
        }}
      />
      {choosing.value && (
        <PercentDialog
          control={choosing.control}
          account={null}
          initial={settings.accountSwitchAt ?? null}
          onSave={(accountSwitchAt) => updateSettings({ accountSwitchAt })}
        />
      )}
    </>
  );
}

export function LimitSettings({
  settings,
  rates,
}: {
  settings: Settings;
  rates: Map<string, UsageRate | null> | null;
}) {
  const accounts = useAccounts()?.accounts ?? null;
  const note = describeUsageLimitNote(settings, accounts, rates);
  return (
    <SettingsGroup title='Limits'>
      <SettingRow title={USAGE_LIMIT_TITLE}>
        <SelectField
          label={USAGE_LIMIT_TITLE}
          items={listUsageLimitItems(settings)}
          value={resolveUsageLimitValue(settings)}
          onValueChange={(value) => void updateSettings({ taskUsageLimit: parseUsageLimit(value) })}
        />
      </SettingRow>
      {note && <SettingsEmpty>{note}</SettingsEmpty>}
      {needsCostLimit(settings, accounts, rates) && (
        <SettingRow title={COST_LIMIT_TITLE}>
          <SelectField
            label={COST_LIMIT_TITLE}
            items={listBudgetItems(settings)}
            value={resolveBudgetValue(settings)}
            onValueChange={(value) => void updateSettings({ taskBudgetUsd: parseBudget(value) })}
          />
        </SettingRow>
      )}
      <SettingRow title={ACCOUNT_LABEL.switchAt}>
        <SwitchAtField settings={settings} />
      </SettingRow>
      <SettingRow title={ACCOUNT_LABEL.afterLimit}>
        <SelectField
          label={ACCOUNT_LABEL.afterLimit}
          items={RESUME_ITEMS}
          value={resolveResumeValue(settings)}
          onValueChange={(value) => void updateSettings({ autoResume: value === 'auto' })}
        />
      </SettingRow>
      {needsSnoozeSetting(settings) && (
        <SettingRow title={SNOOZE_TITLE}>
          <SelectField
            label={SNOOZE_TITLE}
            items={SNOOZE_ITEMS}
            value={resolveSnoozeValue(settings)}
            onValueChange={(value) => void updateSettings({ snoozeLimited: value === 'on' })}
          />
        </SettingRow>
      )}
    </SettingsGroup>
  );
}
