import type { AccountImport, AccountSummary } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import { CARD } from '@/components/layout/surface/card.ts';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { describeRemoval, resolveAccountLabel } from '@/lib/accounts/account.ts';
import { describeAccountSource, isImportedNow } from '@/lib/onboarding.ts';
import { OPTION_ROW } from './options.tsx';

export interface OnboardingAccountActions {
  signIn: (accountId: string | null) => void;
  remove: (accountId: string) => void;
}

function AccountRow({
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
  const signedOut = account.signIn === 'signed_out';
  return (
    <li className={cn(OPTION_ROW, 'cursor-default border-border not-first:border-t')}>
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full bg-bg-a2',
          signedOut ? 'text-amber-text' : 'text-fg-3'
        )}
      >
        <Icon name={signedOut ? 'IconExclamationCircle' : 'IconUser'} size='sm' />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <span className='flex min-w-0 items-center gap-2'>
          <Truncate className='min-w-0 font-medium text-fg-4 text-sm'>
            {resolveAccountLabel(account)}
          </Truncate>
          {isImportedNow(account, imported) && <Badge size='sm'>Added</Badge>}
        </span>
        <span className={cn('text-xs', signedOut ? 'text-amber-text' : 'text-fg-2')}>
          {describeAccountSource(account)}
        </span>
      </span>
      {signedOut && (
        <Button variant='outline' size='sm' onClick={() => actions.signIn(account.id)}>
          Sign in again
        </Button>
      )}
      <Hint label={removal.menu}>
        <Button
          variant='secondary'
          size='icon-sm'
          icon='IconTrashCan'
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
    </li>
  );
}

export function OnboardingAccounts({
  accounts,
  imported,
  notes,
  actions,
}: {
  accounts: AccountSummary[];
  imported: AccountImport[];
  notes: string[];
  actions: OnboardingAccountActions;
}) {
  return (
    <div className='flex flex-col gap-3'>
      <div className={cn(CARD, 'flex flex-col overflow-hidden')}>
        {accounts.length > 0 ? (
          <ul className='flex flex-col'>
            {accounts.map((account) => (
              <AccountRow key={account.id} account={account} imported={imported} actions={actions} />
            ))}
          </ul>
        ) : (
          <p className='px-3.5 py-4 text-fg-2 text-sm'>Shinsa found no Claude login on this machine.</p>
        )}
        <div className='flex items-center border-border border-t bg-bg-a1 px-3.5 py-2.5'>
          <Button variant='outline' size='sm' icon='IconPlusMedium' onClick={() => actions.signIn(null)}>
            {accounts.length > 0 ? 'Add another account' : 'Sign in to Claude'}
          </Button>
        </div>
      </div>
      {notes.map((note) => (
        <p key={note} className='flex items-start gap-1.5 text-amber-text text-xs'>
          <Icon name='IconExclamationCircle' size='sm' className='mt-0.5' />
          {note}
        </p>
      ))}
    </div>
  );
}
