import type { AccountImport, AccountPatch, AccountSummary, AccountsSnapshot, Settings } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { PercentDialog } from '@/components/accounts/percent-dialog.tsx';
import { RefreshButton } from '@/components/accounts/refresh-button.tsx';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import {
  ACCOUNT_LABEL,
  describeDefaultChanged,
  describeImport,
  describeRemoval,
  MOVE_ACTION,
  resolvePauseAction,
} from '@/lib/accounts/account.ts';
import {
  describeSwitchAtChange,
  listAccountSwitchItems,
  OTHER_PERCENT,
  parseSwitchValue,
  resolveAccountSwitchValue,
} from '@/lib/accounts/limits.ts';
import { resolveAccountHeader, resolveUsageModel } from '@/lib/accounts/usage.ts';
import {
  importAccount,
  refreshUsage,
  removeAccount,
  startSignIn,
  updateAccount,
  useAccounts,
} from '@/lib/connection/accounts.ts';
import { SettingsEmpty, SettingsGroup } from './group.tsx';
import { ProviderLoginBlock } from './providers.tsx';
import { UsageWindows } from './usage.tsx';
import { UsageAccountBlock } from './usage-account.tsx';

export interface AccountActions {
  signIn: (accountId: string | null) => void;
  importLogin: (entry: AccountImport) => void;
  update: (accountId: string, patch: AccountPatch, done: string) => Promise<boolean>;
  remove: (accountId: string) => void;
  refresh: () => Promise<unknown>;
}

function AddAccountButton({ imports, actions }: { imports: AccountImport[]; actions: AccountActions }) {
  if (imports.length === 0) {
    return (
      <Button variant='secondary' size='sm' icon='IconUserAdd' onClick={() => actions.signIn(null)}>
        {ACCOUNT_LABEL.add}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='secondary' size='sm' icon='IconUserAdd'>
            {ACCOUNT_LABEL.add}
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='min-w-64'>
        <DropdownMenuItem icon='IconUserKey' onClick={() => actions.signIn(null)}>
          {ACCOUNT_LABEL.signInAnother}
        </DropdownMenuItem>
        {imports.map((entry) => {
          const { label, detail } = describeImport(entry);
          return (
            <DropdownMenuItem
              key={`${entry.origin}-${entry.email}`}
              icon={entry.origin === 'claude' ? 'IconClaudeai' : 'IconArrowsRepeatRightLeft'}
              onClick={() => actions.importLogin(entry)}
            >
              <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
                <Truncate className='text-fg-4'>{label}</Truncate>
                {detail && <span className='shrink-0 text-2xs text-fg-2'>{detail}</span>}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AccountProps {
  account: AccountSummary;
  index: number;
  count: number;
  settings: Settings;
  actions: AccountActions;
}

function AccountOrderItems({ account, index, count, actions }: Omit<AccountProps, 'settings'>) {
  const pause = resolvePauseAction(account);
  const move = (position: number, action: (typeof MOVE_ACTION)['up']) =>
    void actions.update(account.id, { position }, action.done);
  return (
    <>
      {!account.isDefault && (
        <DropdownMenuItem
          icon='IconStar'
          onClick={() =>
            void actions.update(account.id, { isDefault: true }, describeDefaultChanged(account))
          }
        >
          {ACCOUNT_LABEL.makeDefault}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem icon='IconUserKey' onClick={() => actions.signIn(account.id)}>
        {ACCOUNT_LABEL.signInAgain}
      </DropdownMenuItem>
      {index > 0 && (
        <DropdownMenuItem icon={MOVE_ACTION.up.icon} onClick={() => move(index - 1, MOVE_ACTION.up)}>
          {MOVE_ACTION.up.label}
        </DropdownMenuItem>
      )}
      {index < count - 1 && (
        <DropdownMenuItem icon={MOVE_ACTION.down.icon} onClick={() => move(index + 1, MOVE_ACTION.down)}>
          {MOVE_ACTION.down.label}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        icon={pause.icon}
        onClick={() => void actions.update(account.id, { paused: !account.paused }, pause.done)}
      >
        {pause.label}
      </DropdownMenuItem>
    </>
  );
}

function SwitchAtSubmenu({
  account,
  settings,
  actions,
  onOther,
}: Pick<AccountProps, 'account' | 'settings' | 'actions'> & { onOther: () => void }) {
  function pick(value: string) {
    if (value === OTHER_PERCENT) {
      onOther();
      return;
    }
    const switchAt = parseSwitchValue(value);
    void actions.update(account.id, { switchAt }, describeSwitchAtChange(account, switchAt));
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name='IconGauge' />
        {ACCOUNT_LABEL.switchAt}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={resolveAccountSwitchValue(account)}
          onValueChange={(value) => pick(String(value))}
        >
          {listAccountSwitchItems(account, settings).map((item) => (
            <DropdownMenuRadioItem key={item.value} value={item.value} closeOnClick>
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

type AccountDialog = ReturnType<typeof useDialogState<'switch' | 'remove'>>;

function AccountDialogs({
  account,
  actions,
  dialog,
}: Pick<AccountProps, 'account' | 'actions'> & { dialog: AccountDialog }) {
  if (dialog.value === 'switch') {
    return (
      <PercentDialog
        control={dialog.control}
        account={account}
        initial={account.switchAt}
        onSave={(switchAt) =>
          actions.update(account.id, { switchAt }, describeSwitchAtChange(account, switchAt))
        }
      />
    );
  }
  if (dialog.value !== 'remove') return null;
  const removal = describeRemoval(account);
  return (
    <ConfirmDialog
      control={dialog.control}
      title={removal.title}
      body={removal.body}
      action={removal.action}
      onConfirm={() => actions.remove(account.id)}
    />
  );
}

function AccountMenu(props: AccountProps) {
  const { account, settings, actions } = props;
  const dialog = useDialogState<'switch' | 'remove'>();
  return (
    <>
      <DropdownMenu>
        <OptionsTrigger label={ACCOUNT_LABEL.options} />
        <DropdownMenuContent align='end' className='min-w-52'>
          <DropdownMenuGroup>
            <AccountOrderItems {...props} />
            <SwitchAtSubmenu
              account={account}
              settings={settings}
              actions={actions}
              onOther={() => dialog.show('switch')}
            />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon='IconTrashCan' variant='destructive' onClick={() => dialog.show('remove')}>
            {describeRemoval(account).menu}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AccountDialogs account={account} actions={actions} dialog={dialog} />
    </>
  );
}

function AccountBlock(props: AccountProps) {
  const { account, settings } = props;
  return (
    <UsageAccountBlock
      header={resolveAccountHeader(account, resolveUsageModel(settings), Date.now())}
      menu={<AccountMenu {...props} />}
    >
      <UsageWindows account={account} />
    </UsageAccountBlock>
  );
}

const LIVE_ACTIONS: AccountActions = {
  signIn: (accountId) => void startSignIn(accountId),
  importLogin: (entry) => void importAccount(entry),
  update: updateAccount,
  remove: (accountId) => void removeAccount(accountId),
  refresh: refreshUsage,
};

export function AccountsGroup({
  snapshot,
  settings,
  actions,
}: {
  snapshot: AccountsSnapshot;
  settings: Settings;
  actions: AccountActions;
}) {
  const { accounts, imports, providers = [] } = snapshot;
  return (
    <SettingsGroup
      title={ACCOUNT_LABEL.section}
      className='gap-1.5'
      action={
        accounts.length > 0 && (
          <>
            <RefreshButton label={ACCOUNT_LABEL.refreshUsage} onRefresh={actions.refresh} />
            <AddAccountButton imports={imports} actions={actions} />
          </>
        )
      }
    >
      {accounts.length === 0 && (
        <SettingsEmpty action={<AddAccountButton imports={imports} actions={actions} />}>
          {ACCOUNT_LABEL.none}
        </SettingsEmpty>
      )}
      {accounts.map((account, index) => (
        <AccountBlock
          key={account.id}
          account={account}
          index={index}
          count={accounts.length}
          settings={settings}
          actions={actions}
        />
      ))}
      {providers.map((login) => (
        <ProviderLoginBlock key={login.provider} login={login} onRefresh={actions.refresh} />
      ))}
    </SettingsGroup>
  );
}

export function AccountSettings({ settings }: { settings: Settings }) {
  const snapshot = useAccounts();
  if (!snapshot) return null;
  return <AccountsGroup snapshot={snapshot} settings={settings} actions={LIVE_ACTIONS} />;
}
