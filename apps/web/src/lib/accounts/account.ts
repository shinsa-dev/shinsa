import {
  type AccountImport,
  type AccountSummary,
  type AccountSwitchReason,
  type AccountsSnapshot,
  isTaskSettled,
  RUN_STAGES,
  type Run,
  type RunAccount,
  resolveProviderLabel,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';

const ANY_ACCOUNT = 'any';

export const ACCOUNT_LABEL = {
  section: 'Accounts',
  add: 'Add account',
  addClaude: 'Add a Claude account',
  signInAnother: 'Sign in with another account',
  options: 'Account options',
  makeDefault: 'Set as default',
  default: 'Default',
  defaultAccount: 'Default account',
  signIn: 'Sign in',
  signInAgain: 'Sign in again',
  copySignIn: 'Copy the sign-in command',
  usedNext: 'Used for the next turn',
  retryAnyway: 'Retry anyway',
  switchAt: 'Switch accounts at',
  afterLimit: 'After a usage limit',
  runOn: 'Run on account',
  pickRunOn: 'Run on account…',
  rerunOn: 'Run this step again on',
  pickRerunOn: 'Run this step again on…',
  usage: 'Agent usage',
  oneCodexLogin:
    'Shinsa runs Codex on its one login, in `~/.codex`. More than one Codex account is not supported yet.',
  refreshUsage: 'Refresh usage',
  resumeNow: 'Resume now',
  percentage: 'Percentage',
  percentageExample: '85',
  savePercentage: 'Save percentage',
  none: 'Add a Claude account so agents can run on it and switch when one runs out of usage.',
};

export interface AccountAction {
  label: string;
  icon: IconName;
  done: string;
}

export const MOVE_ACTION: Record<'up' | 'down', AccountAction> = {
  up: { label: 'Move up', icon: 'IconArrowUp', done: 'Moved up.' },
  down: { label: 'Move down', icon: 'IconArrowDown', done: 'Moved down.' },
};

export interface AccountChoice {
  value: string;
  label: string;
  account: RunAccount | null;
}

export function resolveAccountLabel(account: { email: string | null }) {
  return account.email ?? 'Claude account';
}

const PROVIDER_ICONS: Record<string, IconName> = { claude: 'IconClaudeai', codex: 'IconOpenaiCodex' };

export function resolveProviderIcon(provider: string): IconName {
  return PROVIDER_ICONS[provider] ?? 'IconRobot';
}

export interface AccountProvider {
  icon: IconName;
  label: string;
}

export function resolveAccountProvider(provider: string, email: string | null): AccountProvider {
  const name = resolveProviderLabel(provider);
  return { icon: resolveProviderIcon(provider), label: email ? `${name} · ${email}` : name };
}

export function listAccountChoices(snapshot: AccountsSnapshot | null, task: Task): AccountChoice[] {
  const accounts = (snapshot?.accounts ?? []).filter(
    (account) => account.signIn !== 'signed_out' || account.id === task.account?.id
  );
  const choices: AccountChoice[] = accounts.map((account) => ({
    value: account.id,
    label: resolveAccountLabel(account),
    account: { id: account.id, email: account.email },
  }));
  const bound = task.account;
  if (bound && !choices.some((choice) => choice.value === bound.id)) {
    choices.push({ value: bound.id, label: resolveAccountLabel(bound), account: bound });
  }
  return [{ value: ANY_ACCOUNT, label: 'Any account', account: null }, ...choices];
}

export function resolveAccountChoiceValue(task: Task) {
  return task.account?.id ?? ANY_ACCOUNT;
}

export function resolveBoundAccount(choices: AccountChoice[], value: string) {
  return choices.find((choice) => choice.value === value)?.account ?? null;
}

export function resolveRunAccount(run: Pick<Run, 'attempts' | 'account'>): RunAccount | null {
  return run.attempts?.at(-1)?.account ?? run.account ?? null;
}

export function selectRerunRun(task: Task, runs: Run[]): Run | null {
  if (isTaskSettled(task) || !RUN_STAGES.has(task.stage)) return null;
  return runs.at(-1) ?? null;
}

export function listRerunChoices(snapshot: AccountsSnapshot | null): AccountChoice[] {
  return (snapshot?.accounts ?? [])
    .filter((account) => account.signIn !== 'signed_out')
    .map((account) => ({
      value: account.id,
      label: resolveAccountLabel(account),
      account: { id: account.id, email: account.email },
    }));
}

export function describeRerun(account: RunAccount) {
  return `Running this step again on ${resolveAccountLabel(account)}.`;
}

export function describeRunsOn(account: RunAccount) {
  return `Runs on ${resolveAccountLabel(account)}`;
}

export function describeBinding(account: RunAccount | null) {
  return account ? `${describeRunsOn(account)}.` : 'Runs on any account.';
}

export function describeDefaultChanged(account: { email: string | null }) {
  return `${resolveAccountLabel(account)} is the default account.`;
}

export function resolvePauseAction(account: AccountSummary): AccountAction {
  const label = resolveAccountLabel(account);
  if (account.paused)
    return { label: 'Use for new work', icon: 'IconPlay', done: `${label} takes new work again.` };
  return { label: 'Leave out of new work', icon: 'IconPause', done: `New work skips ${label}.` };
}

export function describeImported(entry: AccountImport) {
  if (entry.origin === 'claude') return { title: 'Added your Claude Code login.', description: null };
  return {
    title: `Imported ${entry.email}.`,
    description:
      'Remove it from claude-swap or turn off claude-swap’s auto-switch, so only Shinsa refreshes this login.',
  };
}

export function describeImport(entry: AccountImport) {
  if (entry.origin === 'claude') return { label: 'Use your Claude Code login', detail: entry.email };
  return { label: `Import ${entry.email} from claude-swap`, detail: null };
}

export function describeRemoval(account: AccountSummary) {
  if (account.origin === 'claude') {
    return {
      menu: 'Remove from Shinsa',
      title: 'Stop using your Claude Code login?',
      body: 'Shinsa stops running work on it. You stay signed in to Claude Code, and tasks that run only on it go back to any account.',
      action: 'Remove from Shinsa',
    };
  }
  return {
    menu: 'Remove',
    title: `Remove ${resolveAccountLabel(account)}?`,
    body: 'Shinsa signs this account out and deletes its folder. Tasks that run only on it go back to any account.',
    action: 'Remove account',
  };
}

export const SWITCH_REASON: Record<AccountSwitchReason, string> = {
  usage_limit: 'The previous account hit its usage limit.',
  signed_out: 'The previous account is signed out.',
  headroom: 'This account has more usage left.',
  bound: 'This task runs only on this account.',
};
