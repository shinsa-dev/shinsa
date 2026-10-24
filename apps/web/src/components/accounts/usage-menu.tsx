import type { AccountSummary, AccountsSnapshot, Settings, ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { AccountStatusText } from '@/components/accounts/account-status.tsx';
import { ResetTime, UsageBar } from '@/components/accounts/usage-bar.tsx';
import { UsagePercent } from '@/components/accounts/usage-percent.tsx';
import { InfoHeader, InfoPopover, InfoSection } from '@/components/overlays/info-popover.tsx';
import { ACCOUNT_LABEL, resolveAccountLabel } from '@/lib/accounts/account.ts';
import {
  type AccountStatus,
  describeGlance,
  describeUsageDetail,
  listProviderGlances,
  type ProviderGlance,
  resolveAccountStatus,
  resolveUsageGlance,
  resolveUsageModel,
  selectHighestRow,
  type UsageRow,
} from '@/lib/accounts/usage.ts';
import { openSettingsSection } from '@/lib/command/settings.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';

function GlanceRow({
  label,
  row,
  status,
  detail,
}: {
  label: string;
  row: UsageRow | null;
  status: AccountStatus | null;
  detail: string;
}) {
  return (
    <InfoSection>
      <div className='flex flex-col gap-1.5 px-3 py-1.5'>
        <div className='flex items-center justify-between gap-4 text-xs'>
          <span className='min-w-0 truncate text-fg-4'>{label}</span>
          {row && <UsagePercent percent={row.percent} />}
        </div>
        {row ? (
          <>
            <UsageBar row={row} />
            <span className='flex items-center justify-between gap-4 text-2xs text-fg-2'>
              <span className='min-w-0 truncate'>{row.label}</span>
              {status ? (
                <AccountStatusText status={status} />
              ) : (
                row.resetsAt !== null && (
                  <span className='shrink-0'>
                    <ResetTime at={row.resetsAt} />
                  </span>
                )
              )}
            </span>
          </>
        ) : (
          <span className='flex items-center justify-between gap-4 text-2xs text-fg-2'>
            <span className='min-w-0'>{detail}</span>
            {status && <AccountStatusText status={status} />}
          </span>
        )}
      </div>
    </InfoSection>
  );
}

function AccountGlance({ account, model, now }: { account: AccountSummary; model: string; now: number }) {
  return (
    <GlanceRow
      label={resolveAccountLabel(account)}
      row={selectHighestRow(account, model)}
      status={resolveAccountStatus(account, model, now)}
      detail={describeUsageDetail(account)}
    />
  );
}

function ProviderGlanceRow({ glance }: { glance: ProviderGlance }) {
  return (
    <GlanceRow
      label={glance.label}
      row={glance.row}
      status={glance.status}
      detail={describeUsageDetail(glance)}
    />
  );
}

export function UsageMenuButton({
  snapshot,
  settings,
  onOpen,
  className,
}: {
  snapshot: AccountsSnapshot | null;
  settings: Settings;
  onOpen: () => void;
  className?: string;
}) {
  const now = Date.now();
  const glance = resolveUsageGlance(snapshot, settings, now);
  if (!snapshot || !glance) return null;
  const model = resolveUsageModel(settings);
  return (
    <InfoPopover
      className='w-72'
      render={
        <Button
          variant='secondary'
          size='sm'
          icon='IconGauge'
          aria-label={ACCOUNT_LABEL.usage}
          className={className}
          onClick={onOpen}
        />
      }
      trigger={glance.row ? <UsagePercent percent={glance.row.percent} /> : ACCOUNT_LABEL.usage}
    >
      <InfoHeader title={ACCOUNT_LABEL.usage} description={describeGlance(glance)} />
      {snapshot.accounts.map((account) => (
        <AccountGlance key={account.id} account={account} model={model} now={now} />
      ))}
      {listProviderGlances(snapshot, now).map((provider) => (
        <ProviderGlanceRow key={provider.login.provider} glance={provider} />
      ))}
    </InfoPopover>
  );
}

export function UsageMenu({ state, className }: { state: ShinsaState; className?: string }) {
  return (
    <UsageMenuButton
      snapshot={useAccounts()}
      settings={state.settings}
      onOpen={() => openSettingsSection(ACCOUNT_LABEL.section)}
      className={className}
    />
  );
}
