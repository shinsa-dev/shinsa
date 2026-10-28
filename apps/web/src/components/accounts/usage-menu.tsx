import {
  type AccountSummary,
  type AccountsSnapshot,
  CLAUDE_PROVIDER,
  type Settings,
  type ShinsaState,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { AccountName } from '@/components/accounts/account-name.tsx';
import { AccountStatusText } from '@/components/accounts/account-status.tsx';
import { ResetTime, UsageBar } from '@/components/accounts/usage-bar.tsx';
import { UsagePercent } from '@/components/accounts/usage-percent.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { InfoHeader, InfoPopover, InfoSection } from '@/components/overlays/info-popover.tsx';
import { useUsageRecheck } from '@/hooks/use-usage-recheck.ts';
import { ACCOUNT_LABEL, type AccountProvider, resolveAccountProvider } from '@/lib/accounts/account.ts';
import {
  type AccountStatus,
  describeUsageDetail,
  isNextAccount,
  isNextProvider,
  listProviderGlances,
  type ProviderGlance,
  resolveAccountStatus,
  resolveUsageGlance,
  resolveUsageModel,
  resolveUsageText,
  selectGlanceRow,
  type UsageGlance,
  type UsageRow,
} from '@/lib/accounts/usage.ts';
import { openSettingsSection } from '@/lib/command/settings.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { TONE_FILL } from '@/lib/format/tone.ts';

function NextMark() {
  return (
    <Hint label={ACCOUNT_LABEL.usedNext}>
      <span
        role='img'
        aria-label={ACCOUNT_LABEL.usedNext}
        className={cn('size-1.5 shrink-0 rounded-full', TONE_FILL.blue)}
      />
    </Hint>
  );
}

function GlanceRow({
  name,
  row,
  status,
  detail,
  next,
}: {
  name: AccountProvider;
  row: UsageRow | null;
  status: AccountStatus | null;
  detail: string;
  next: boolean;
}) {
  return (
    <InfoSection>
      <div className='flex flex-col gap-1.5 px-3 py-1.5'>
        <div className='flex items-center justify-between gap-4 text-xs'>
          <span className='flex min-w-0 items-center gap-1.5'>
            <AccountName name={name} className='text-fg-4' />
            {next && <NextMark />}
          </span>
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

function AccountGlance({
  account,
  model,
  now,
  next,
}: {
  account: AccountSummary;
  model: string;
  now: number;
  next: UsageGlance;
}) {
  return (
    <GlanceRow
      name={resolveAccountProvider(CLAUDE_PROVIDER, account.email)}
      row={selectGlanceRow(account, model)}
      status={resolveAccountStatus(account, model, now)}
      detail={describeUsageDetail(account)}
      next={isNextAccount(next, account)}
    />
  );
}

function ProviderGlanceRow({ glance, next }: { glance: ProviderGlance; next: UsageGlance }) {
  return (
    <GlanceRow
      name={glance.name}
      row={glance.row}
      status={glance.status}
      detail={describeUsageDetail(glance)}
      next={isNextProvider(next, glance.login)}
    />
  );
}

export function UsageMenuButton({
  snapshot,
  settings,
  onOpen,
  className,
  children,
}: {
  snapshot: AccountsSnapshot | null;
  settings: Settings;
  onOpen: () => void;
  className?: string;
  children?: React.ReactNode;
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
          icon={{
            name: 'IconGauge',
            className: glance.row ? resolveUsageText(glance.row.percent) : undefined,
          }}
          aria-label={ACCOUNT_LABEL.usage}
          className={className}
          onClick={onOpen}
        />
      }
      trigger={glance.row ? <UsagePercent percent={glance.row.percent} /> : ACCOUNT_LABEL.usage}
    >
      <InfoHeader title={ACCOUNT_LABEL.usage} />
      {snapshot.accounts.map((account) => (
        <AccountGlance key={account.id} account={account} model={model} now={now} next={glance} />
      ))}
      {listProviderGlances(snapshot, now).map((provider) => (
        <ProviderGlanceRow key={provider.login.provider} glance={provider} next={glance} />
      ))}
      {children}
    </InfoPopover>
  );
}

function UsageRecheckWhileOpen() {
  useUsageRecheck(true);
  return null;
}

export function UsageMenu({ state, className }: { state: ShinsaState; className?: string }) {
  return (
    <UsageMenuButton
      snapshot={useAccounts()}
      settings={state.settings}
      onOpen={() => openSettingsSection(ACCOUNT_LABEL.section)}
      className={className}
    >
      <UsageRecheckWhileOpen />
    </UsageMenuButton>
  );
}
