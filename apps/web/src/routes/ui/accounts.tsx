import { type AccountSummary, createSettings } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@shinsa/ui/components/dropdown-menu';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { AccountChoiceList, RunAccountLabel } from '@/components/accounts/account-items.tsx';
import { AccountStatusText } from '@/components/accounts/account-status.tsx';
import { PercentDialog } from '@/components/accounts/percent-dialog.tsx';
import { SignInPrompt } from '@/components/accounts/sign-in-dialog.tsx';
import { UsageBar } from '@/components/accounts/usage-bar.tsx';
import { UsageMenuButton } from '@/components/accounts/usage-menu.tsx';
import { UsagePercent } from '@/components/accounts/usage-percent.tsx';
import {
  ACCOUNT_LABEL,
  listAccountChoices,
  listRerunChoices,
  resolveAccountChoiceValue,
  resolveAccountLabel,
} from '@/lib/accounts/account.ts';
import { LOGIN_TITLE, type LoginView } from '@/lib/accounts/sign-in.ts';
import { resolveAccountStatus, resolveUsageTone } from '@/lib/accounts/usage.ts';
import { createSampleAccounts } from './sample-accounts.ts';
import { acknowledgeSample, createSampleTask } from './samples.ts';
import { Specimen } from './section.tsx';

const USAGE_PERCENTS = [42, 81, 96];

const LOGIN_VIEWS: LoginView[] = [
  { phase: 'starting' },
  { phase: 'waiting', loginId: 'sample-login', url: 'https://claude.ai/oauth/authorize' },
  { phase: 'finishing' },
  { phase: 'done', email: 'christo@superwall.com' },
  { phase: 'failed', message: 'Claude stopped the sign-in without saying why.' },
];

function SignInPhases() {
  const dialog = useDialogState<LoginView>();
  return (
    <>
      {LOGIN_VIEWS.map((entry) => (
        <Button key={entry.phase} variant='outline' size='sm' onClick={() => dialog.show(entry)}>
          {LOGIN_TITLE[entry.phase]}
        </Button>
      ))}
      {dialog.value && (
        <SignInPrompt
          open={dialog.open}
          view={dialog.value}
          onClose={dialog.close}
          onSubmitCode={acknowledgeSample}
          onRetry={() => void acknowledgeSample()}
        />
      )}
    </>
  );
}

function PercentChoice({ account }: { account: AccountSummary | null }) {
  const dialog = useDialogState<'other'>();
  return (
    <>
      <Button variant='outline' size='sm' onClick={() => dialog.show('other')}>
        {ACCOUNT_LABEL.switchAt}…
      </Button>
      {dialog.value && (
        <PercentDialog control={dialog.control} account={account} initial={null} onSave={acknowledgeSample} />
      )}
    </>
  );
}

export function AccountSpecimens() {
  const [now] = React.useState(Date.now);
  const [snapshot] = React.useState(() => createSampleAccounts(now));
  const [task] = React.useState(() =>
    createSampleTask(now, { id: 'bound', title: 'Stream MCP tool results' })
  );
  const [bound, setBound] = React.useState(resolveAccountChoiceValue(task));
  const [rerunOn, setRerunOn] = React.useState('work');
  const settings = createSettings();
  const [first] = snapshot.accounts;
  const choices = listRerunChoices(snapshot);
  const rerunLabel = choices.find((choice) => choice.value === rerunOn)?.label ?? null;
  return (
    <>
      <Specimen label='UsageBar · UsagePercent · neutral, amber from 75%, red from 90%'>
        {USAGE_PERCENTS.map((percent) => (
          <span key={percent} className='flex items-center gap-2'>
            <UsageBar row={{ percent, tone: resolveUsageTone(percent) }} className='w-40' />
            <UsagePercent percent={percent} />
          </span>
        ))}
      </Specimen>
      <Specimen label='UsageMenuButton · Agent usage: the next run’s account; hover for every account and provider, click goes to Settings → Agent usage'>
        <UsageMenuButton snapshot={snapshot} settings={settings} onOpen={() => void acknowledgeSample()} />
      </Specimen>
      <Specimen label='AccountStatusText · only when something is wrong'>
        {snapshot.accounts.map((account) => {
          const status = resolveAccountStatus(account, null, now);
          return (
            status && (
              <span key={account.id} className='flex items-center gap-1.5 text-xs'>
                <Truncate className='max-w-40 text-fg-4'>{resolveAccountLabel(account)}</Truncate>
                <AccountStatusText status={status} />
              </span>
            )
          );
        })}
      </Specimen>
      <Specimen label='PercentDialog · Switch accounts at → Other…'>
        <PercentChoice account={first ?? null} />
      </Specimen>
      <Specimen label='Sign-in dialog · one button per phase'>
        <SignInPhases />
      </Specimen>
      <Specimen label='AccountChoiceList · Run on account, the bound account checked'>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant='secondary' size='sm' icon='IconUser' />}>
            {ACCOUNT_LABEL.runOn}
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='max-w-80'>
            <AccountChoiceList
              choices={listAccountChoices(snapshot, task)}
              value={bound}
              onPick={(account) => setBound(resolveAccountChoiceValue({ ...task, account }))}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </Specimen>
      <Specimen label='RunAccountLabel · an earlier run (plain) · the current step (Run this step again on)'>
        <div className='flex w-full max-w-xl flex-col'>
          <span className='flex min-w-0 items-center gap-1 px-3 py-2 text-2xs text-fg-2'>
            <Truncate>Phase 1 of 2: Open an MCP session per chat</Truncate>
            <RunAccountLabel label='christo@example.com' choices={[]} value='side' onPick={() => undefined} />
          </span>
          <span className='flex min-w-0 items-center gap-1 px-3 py-2 text-2xs text-fg-2'>
            <Truncate>Phase 2 of 2: Stream tool results to the chat</Truncate>
            <RunAccountLabel
              label={rerunLabel}
              choices={choices}
              value={rerunOn}
              onPick={(account) => setRerunOn(account?.id ?? rerunOn)}
            />
          </span>
        </div>
      </Specimen>
    </>
  );
}
