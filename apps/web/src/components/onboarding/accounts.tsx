import type { AccountImport, AccountSummary, ProviderLogin } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { PathRow, SETTING_ROW, SettingsCard, SettingsEmpty } from '@/components/settings/group.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import {
  ACCOUNT_LABEL,
  describeImport,
  describeRemoval,
  resolveAccountLabel,
  resolveImportIcon,
  resolveProviderIcon,
} from '@/lib/accounts/account.ts';
import {
  describeAccountSource,
  describeProviderSource,
  isImportedNow,
  resolveProviderChoice,
} from '@/lib/onboarding.ts';

export interface OnboardingAccountActions {
  signIn: (accountId: string | null) => void;
  importLogin: (entry: AccountImport) => void;
  remove: (accountId: string) => void;
  copy: (text: string) => void;
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

export function OnboardingAddAccount({
  accounts,
  imports,
  providers,
  actions,
}: {
  accounts: AccountSummary[] | null;
  imports: AccountImport[];
  providers: ProviderLogin[];
  actions: OnboardingAccountActions;
}) {
  const claude = accounts?.length === 0 ? 'Sign in to Claude' : 'Claude account';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='secondary' icon='IconUserAdd'>
            {ACCOUNT_LABEL.add}
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='min-w-64'>
        <DropdownMenuItem icon='IconClaudeai' onClick={() => actions.signIn(null)}>
          <span className='flex min-w-0 flex-1 flex-col'>
            <span className='text-fg-4'>{claude}</span>
            <span className='text-2xs text-fg-2'>Opens the Claude sign-in</span>
          </span>
        </DropdownMenuItem>
        {imports.map((entry) => {
          const { label, detail } = describeImport(entry);
          return (
            <DropdownMenuItem
              key={`${entry.origin}-${entry.email}`}
              icon={resolveImportIcon(entry)}
              onClick={() => actions.importLogin(entry)}
            >
              <span className='flex min-w-0 flex-1 flex-col'>
                <span className='text-fg-4'>{label}</span>
                <span className='text-2xs text-fg-2'>{detail}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
        {providers.map((login) => {
          const choice = resolveProviderChoice(login);
          return (
            <DropdownMenuItem
              key={login.provider}
              icon={resolveProviderIcon(login.provider)}
              disabled={choice.command === null}
              onClick={() => {
                if (choice.command) actions.copy(choice.command);
              }}
            >
              <span className='flex min-w-0 flex-1 flex-col'>
                <span className='text-fg-4'>{choice.label}</span>
                <span className='text-2xs text-fg-2'>{choice.detail}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
  providers,
  imported,
  notes,
  actions,
}: {
  accounts: AccountSummary[] | null;
  providers: ProviderLogin[];
  imported: AccountImport[];
  notes: string[];
  actions: OnboardingAccountActions;
}) {
  return (
    <div className='flex flex-col gap-3'>
      <SettingsCard>
        <AccountRows accounts={accounts} imported={imported} actions={actions} />
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
      {notes.map((note) => (
        <p key={note} className='flex items-start gap-1.25 px-1 text-amber-text text-xs'>
          <Icon name='IconExclamationCircle' size='sm' className='mt-px' />
          {note}
        </p>
      ))}
    </div>
  );
}
