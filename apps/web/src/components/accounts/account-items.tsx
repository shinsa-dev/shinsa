import { isTaskSettled, type Run, type Task } from '@shinsa/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import {
  ACCOUNT_LABEL,
  type AccountChoice,
  listAccountChoices,
  listRerunChoices,
  resolveAccountChoiceValue,
  resolveAccountLabel,
  resolveBoundAccount,
  resolveRunAccount,
} from '@/lib/accounts/account.ts';
import { bindTaskAccount, rerunStep, useAccounts } from '@/lib/connection/accounts.ts';

export function AccountChoiceList({
  choices,
  value,
  onPick,
}: {
  choices: AccountChoice[];
  value: string;
  onPick: (account: AccountChoice['account']) => void;
}) {
  return (
    <DropdownMenuRadioGroup
      value={value}
      onValueChange={(picked) => onPick(resolveBoundAccount(choices, String(picked)))}
    >
      <DropdownMenuLabel>{ACCOUNT_LABEL.runOn}</DropdownMenuLabel>
      {choices.map((choice) => (
        <DropdownMenuRadioItem key={choice.value} value={choice.value}>
          <Icon name={choice.account ? 'IconUser' : 'IconUserDuo'} />
          <Truncate>{choice.label}</Truncate>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export function AccountChoiceItems({ task }: { task: Task }) {
  return (
    <AccountChoiceList
      choices={listAccountChoices(useAccounts(), task)}
      value={resolveAccountChoiceValue(task)}
      onPick={(account) => void bindTaskAccount(task.id, account)}
    />
  );
}

export function AccountSubmenu({ task }: { task: Task }) {
  const choices = listAccountChoices(useAccounts(), task);
  if (isTaskSettled(task) || choices.length <= 1) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name='IconUser' />
        {ACCOUNT_LABEL.runOn}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='max-w-80'>
        <AccountChoiceItems task={task} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function RunAccountLabel({
  label,
  choices,
  value,
  onPick,
}: {
  label: string | null;
  choices: AccountChoice[];
  value: string;
  onPick: (account: AccountChoice['account']) => void;
}) {
  if (choices.length === 0) {
    return label ? <span className='shrink-0'>· {label}</span> : null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            className='shrink-0 cursor-pointer transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
          />
        }
      >
        · {label ?? ACCOUNT_LABEL.pickRerunOn}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-48 max-w-80'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(picked) => onPick(resolveBoundAccount(choices, String(picked)))}
        >
          <DropdownMenuLabel>{ACCOUNT_LABEL.rerunOn}</DropdownMenuLabel>
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              <Icon name='IconUser' />
              <Truncate>{choice.label}</Truncate>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RunAccount({ task, run, rerun }: { task: Task; run: Run; rerun: boolean }) {
  const choices = listRerunChoices(useAccounts());
  const account = resolveRunAccount(run);
  return (
    <RunAccountLabel
      label={account ? resolveAccountLabel(account) : null}
      choices={rerun ? choices : []}
      value={account?.id ?? ''}
      onPick={(picked) => {
        if (picked) void rerunStep(task.id, picked);
      }}
    />
  );
}
