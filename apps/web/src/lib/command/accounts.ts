import {
  type AccountsSnapshot,
  isTaskSettled,
  resolvePlanLabel,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import {
  ACCOUNT_LABEL,
  describeDefaultChanged,
  listAccountChoices,
  listRerunChoices,
  resolveAccountChoiceValue,
  resolveAccountLabel,
  resolveBoundAccount,
  resolveRunAccount,
  selectRerunRun,
} from '@/lib/accounts/account.ts';
import { describeUsageWaitToggle, isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';
import { listChatRuns } from '@/lib/chat/delegations.ts';
import { listTaskRuns } from '@/lib/chat/runs.ts';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { openSettingsSection } from '@/lib/command/settings.ts';
import {
  bindTaskAccount,
  rerunStep,
  resumeUsageWaitNow,
  startSignIn,
  updateAccount,
  updateUsageWait,
} from '@/lib/connection/accounts.ts';

export function listAccountSections(snapshot: AccountsSnapshot | null): CommandSection[] {
  const accounts = snapshot?.accounts ?? [];
  const preferred = accounts.find((account) => account.isDefault);
  const commands: Command[] = [
    {
      kind: 'run',
      id: 'accounts.add',
      label: ACCOUNT_LABEL.addClaude,
      icon: 'IconUserAdd',
      keywords: ['account', 'sign in', 'login', 'claude'],
      run: () => void startSignIn(),
    },
    {
      kind: 'run',
      id: 'accounts.usage',
      label: ACCOUNT_LABEL.usage,
      icon: 'IconGauge',
      keywords: ['usage', 'limits', 'quota', 'reset', 'accounts', 'claude', 'codex', 'providers'],
      run: () => openSettingsSection(ACCOUNT_LABEL.section),
    },
  ];
  if (accounts.length > 0) {
    commands.push({
      kind: 'choice',
      id: 'accounts.default',
      label: ACCOUNT_LABEL.defaultAccount,
      ...(preferred ? { hint: resolveAccountLabel(preferred) } : {}),
      icon: 'IconStar',
      keywords: ['account', 'default', 'claude', 'switch'],
      heading: ACCOUNT_LABEL.makeDefault,
      value: preferred?.id ?? null,
      options: accounts.map((account) => ({
        value: account.id,
        label: resolveAccountLabel(account),
        keywords: ['account', resolvePlanLabel(account.plan) ?? ''],
      })),
      pick: (accountId) => {
        const account = accounts.find((candidate) => candidate.id === accountId);
        if (account) void updateAccount(account.id, { isDefault: true }, describeDefaultChanged(account));
      },
    });
  }
  return [{ id: 'global.accounts', heading: 'Accounts', rank: RANK.global + 3, commands }];
}

export function listUsageWaitCommands(task: Task): Command[] {
  if (!isUsageWaitArmed(task)) return [];
  const wait = task.usageWait;
  return [
    {
      kind: 'run',
      id: `task.${task.id}.usage.resume`,
      label: ACCOUNT_LABEL.resumeNow,
      icon: 'IconPlay',
      keywords: ['usage limit', 'resume', 'continue', 'wait'],
      run: () => void resumeUsageWaitNow(task.id),
    },
    {
      kind: 'run',
      id: `task.${task.id}.usage.toggle`,
      label: describeUsageWaitToggle(wait),
      icon: wait.autoResume ? 'IconPause' : 'IconHourglass',
      keywords: ['usage limit', 'resume', 'automatically', 'reset'],
      run: () => void updateUsageWait(task.id, !wait.autoResume),
    },
  ];
}

export function listAccountBindingCommands(snapshot: AccountsSnapshot | null, task: Task): Command[] {
  const choices = listAccountChoices(snapshot, task);
  if (isTaskSettled(task) || choices.length <= 1) return [];
  const value = resolveAccountChoiceValue(task);
  return [
    {
      kind: 'choice',
      id: `task.${task.id}.account`,
      label: ACCOUNT_LABEL.pickRunOn,
      hint: choices.find((choice) => choice.value === value)?.label,
      icon: 'IconUser',
      keywords: ['account', 'claude', 'bind', 'login'],
      heading: ACCOUNT_LABEL.runOn,
      value,
      options: choices.map((choice) => ({ value: choice.value, label: choice.label, keywords: ['account'] })),
      pick: (picked) => void bindTaskAccount(task.id, resolveBoundAccount(choices, picked)),
    },
  ];
}

export function listRerunCommands(
  state: ShinsaState,
  snapshot: AccountsSnapshot | null,
  task: Task
): Command[] {
  const run = selectRerunRun(task, listChatRuns(listTaskRuns(state.runs, task.id)));
  const choices = listRerunChoices(snapshot);
  if (!run || choices.length === 0) return [];
  const current = resolveRunAccount(run);
  return [
    {
      kind: 'choice',
      id: `task.${task.id}.rerun`,
      label: ACCOUNT_LABEL.pickRerunOn,
      ...(current ? { hint: resolveAccountLabel(current) } : {}),
      icon: 'IconArrowsRepeat',
      keywords: ['account', 'claude', 'rerun', 'retry', 'restart', 'step', 'again'],
      heading: ACCOUNT_LABEL.rerunOn,
      value: current?.id ?? null,
      options: choices.map((choice) => ({ value: choice.value, label: choice.label, keywords: ['account'] })),
      pick: (picked) => {
        const account = resolveBoundAccount(choices, picked);
        if (account) void rerunStep(task.id, account);
      },
    },
  ];
}
