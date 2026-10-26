import type { AccountImport, AccountSummary } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { PathRow, SETTING_ROW, SettingsCard, SettingsEmpty } from '@/components/settings/group.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { describeRemoval, resolveAccountLabel, resolveProviderIcon } from '@/lib/accounts/account.ts';
import { describeAccountSource, isImportedNow } from '@/lib/onboarding.ts';

export interface OnboardingAccountActions {
  signIn: (accountId: string | null) => void;
  remove: (accountId: string) => void;
}

function AccountActions({
  account,
  imported,
  actions,
}: {
  account: AccountSummary;
  imported: AccountImport[];
  actions: OnboardingAccountActions;
}) {
  const dialog = useDialogState<true>();
  const removal = describeRemoval(account);
  return (
    <span className='flex shrink-0 items-center gap-1.5'>
      {isImportedNow(account, imported) && <Badge size='sm'>Added</Badge>}
      {account.signIn === 'signed_out' && (
        <Button variant='secondary' size='sm' onClick={() => actions.signIn(account.id)}>
          Sign in again
        </Button>
      )}
      <Hint label={removal.menu}>
        <Button
          variant='secondary'
          size='icon-sm'
          icon='IconCrossSmall'
          aria-label={removal.menu}
          onClick={() => dialog.show(true)}
        />
      </Hint>
      {dialog.value && (
        <ConfirmDialog
          control={dialog.control}
          title={removal.title}
          body={removal.body}
          action={removal.action}
          onConfirm={() => actions.remove(account.id)}
        />
      )}
    </span>
  );
}

function AccountRows({
  accounts,
  imported,
  actions,
}: {
  accounts: AccountSummary[] | null;
  imported: AccountImport[];
  actions: OnboardingAccountActions;
}) {
  if (accounts === null) {
    return (
      <div className={SETTING_ROW}>
        <LoadingLine label='Reading your accounts' className='text-xs' />
      </div>
    );
  }
  if (accounts.length === 0)
    return <SettingsEmpty>Shinsa found no Claude login on this machine.</SettingsEmpty>;
  return (
    <ul className='flex flex-col'>
      {accounts.map((account) => (
        <li key={account.id}>
          <PathRow
            icon={resolveProviderIcon('claude')}
            iconLabel='Claude'
            title={resolveAccountLabel(account)}
            path={describeAccountSource(account)}
            action={<AccountActions account={account} imported={imported} actions={actions} />}
          />
        </li>
      ))}
    </ul>
  );
}

export function OnboardingAccounts({
  accounts,
  imported,
  notes,
  actions,
}: {
  accounts: AccountSummary[] | null;
  imported: AccountImport[];
  notes: string[];
  actions: OnboardingAccountActions;
}) {
  return (
    <div className='flex flex-col gap-3'>
      <SettingsCard>
        <AccountRows accounts={accounts} imported={imported} actions={actions} />
      </SettingsCard>
      {notes.map((note) => (
        <p key={note} className='flex items-start gap-1.25 px-1 text-amber-text text-xs'>
          <Icon name='IconExclamationCircle' size='sm' className='mt-px' />
          {note}
        </p>
      ))}
    </div>
  );
}
