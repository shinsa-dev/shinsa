import type { AccountSummary, ProviderLogin } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { PathRow, SETTING_ROW, SettingsCard, SettingsEmpty } from '@/components/settings/group.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import {
  ACCOUNT_LABEL,
  describeRemoval,
  resolveAccountLabel,
  resolveProviderIcon,
} from '@/lib/accounts/account.ts';
import { describeAccountSource, describeProviderSource, resolveProviderChoice } from '@/lib/onboarding.ts';

export interface OnboardingAccountActions {
  signIn: (accountId: string | null) => void;
  remove: (accountId: string) => void;
}

function AccountActions({
  account,
  actions,
}: {
  account: AccountSummary;
  actions: OnboardingAccountActions;
}) {
  const dialog = useDialogState<true>();
  const removal = describeRemoval(account);
  return (
    <span className='flex shrink-0 items-center gap-1.5'>
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

function ProviderRow({ login }: { login: ProviderLogin }) {
  const { command } = resolveProviderChoice(login);
  return (
    <PathRow
      icon={resolveProviderIcon(login.provider)}
      iconLabel={login.label}
      title={login.email ?? login.label}
      path={describeProviderSource(login)}
      action={command ? <CopyButton text={command} /> : undefined}
    />
  );
}

export function OnboardingAddAccount({ actions }: { actions: OnboardingAccountActions }) {
  return (
    <Button variant='secondary' icon='IconUserAdd' onClick={() => actions.signIn(null)}>
      {ACCOUNT_LABEL.add}
    </Button>
  );
}

function AccountRows({
  accounts,
  actions,
}: {
  accounts: AccountSummary[] | null;
  actions: OnboardingAccountActions;
}) {
  if (accounts === null) {
    return (
      <div className={SETTING_ROW}>
        <LoadingLine label='Reading your accounts' className='text-xs' />
      </div>
    );
  }
  if (accounts.length === 0) {
    return (
      <SettingsEmpty
        action={
          <Button icon='IconClaudeai' onClick={() => actions.signIn(null)}>
            Sign in with Claude
          </Button>
        }
      >
        No Claude account yet. Agents need one to work.
      </SettingsEmpty>
    );
  }
  return (
    <ul className='flex flex-col'>
      {accounts.map((account) => (
        <li key={account.id}>
          <PathRow
            icon={resolveProviderIcon('claude')}
            iconLabel='Claude'
            title={resolveAccountLabel(account)}
            path={describeAccountSource(account)}
            action={<AccountActions account={account} actions={actions} />}
          />
        </li>
      ))}
    </ul>
  );
}

export function OnboardingAccounts({
  accounts,
  providers,
  actions,
}: {
  accounts: AccountSummary[] | null;
  providers: ProviderLogin[];
  actions: OnboardingAccountActions;
}) {
  return (
    <div className='flex flex-col gap-3'>
      <SettingsCard>
        <AccountRows accounts={accounts} actions={actions} />
        {providers.length > 0 && (
          <ul className='flex flex-col'>
            {providers.map((login) => (
              <li key={login.provider}>
                <ProviderRow login={login} />
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}
