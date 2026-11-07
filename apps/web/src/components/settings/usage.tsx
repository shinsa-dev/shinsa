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
  resolveWatchdogLimitsValue,
  SNOOZE_ITEMS,
  SNOOZE_TITLE,
  WATCHDOG_LIMITS_ITEMS,
  WATCHDOG_LIMITS_TITLE,
} from '@/lib/accounts/limits.ts';
import {
  describeUsageDetail,
  listUsageNotes,
  listUsageRows,
  type UsageNoteRow,
  type UsageRow,
} from '@/lib/accounts/usage.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import {
  COST_LIMIT_TITLE,
  DAILY_LIMIT_TITLE,
  describeDailyLimitNote,
  describeUsageLimitNote,
  listDailyLimitItems,
  listBudgetItems,
  listUsageLimitItems,
  needsCostLimit,
  parseBudget,
  parseUsageLimit,
  resolveBudgetValue,
  resolveDailyLimitValue,
  resolveUsageLimitValue,
  USAGE_LIMIT_TITLE,
  updateSettings,
} from '@/lib/settings.ts';
import { SETTING_ROW, SettingRow, SettingsEmpty, SettingsGroup } from './group.tsx';

function WindowRow({ row }: { row: UsageRow }) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col gap-px'>
        <Truncate className='text-xs text-fg-4'>{row.label}</Truncate>
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
      <span className='min-w-0 flex-1 text-xs text-fg-2'>{text}</span>
    </div>
  );
}

export function UsageWindows({ account }: { account: { usage: AccountUsage } }) {
  const rows = listUsageRows(account);
  if (rows.length === 0) return <DetailRow text={describeUsageDetail(account)} />;
  return rows.map((row) => <WindowRow key={row.id} row={row} />);
}

function NoteRow({ row }: { row: UsageNoteRow }) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col gap-px'>
        <Truncate className='text-xs text-fg-4'>{row.label}</Truncate>
        {row.detail && <span className='text-2xs text-fg-2'>{row.detail}</span>}
      </div>
      <span className='shrink-0 text-xs text-fg-3 tabular-nums'>{row.value}</span>
    </div>
  );
}

export function UsageNotes({ usage, now }: { usage: AccountUsage; now: number }) {
  return listUsageNotes(usage, now).map((row) => <NoteRow key={row.id} row={row} />);
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
  recentUsage,
}: {
  settings: Settings;
  rates: Map<string, UsageRate | null> | null;
  recentUsage: number;
}) {
  const accounts = useAccounts()?.accounts ?? null;
  const note = describeUsageLimitNote(settings, accounts, rates);
  const dailyNote = describeDailyLimitNote(settings, recentUsage);
  const paced = useEngineFeature('usage.pace_limits');
  const watchdogLimits = useEngineFeature('usage.watchdog_limits');
  return (
    <SettingsGroup title='Limits'>
      {paced && (
        <SettingRow title={DAILY_LIMIT_TITLE}>
          <SelectField
            label={DAILY_LIMIT_TITLE}
            items={listDailyLimitItems(settings)}
            value={resolveDailyLimitValue(settings)}
            onValueChange={(value) => void updateSettings({ dailyUsageLimit: parseUsageLimit(value) })}
          />
        </SettingRow>
      )}
      {paced && dailyNote && <SettingsEmpty>{dailyNote}</SettingsEmpty>}
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
      {watchdogLimits && (
        <SettingRow title={WATCHDOG_LIMITS_TITLE}>
          <SelectField
            label={WATCHDOG_LIMITS_TITLE}
            items={WATCHDOG_LIMITS_ITEMS}
            value={resolveWatchdogLimitsValue(settings)}
            onValueChange={(value) => void updateSettings({ watchdogsIgnoreUsageLimits: value === 'ignore' })}
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
