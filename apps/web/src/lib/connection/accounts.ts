import type { AccountImport, AccountPatch, AccountsSnapshot, RunAccount } from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { describeBinding, describeRerun } from '@/lib/accounts/account.ts';
import { createUsageRecheck } from '@/lib/accounts/recheck.ts';
import { type SignInDialogState, selectDialogLogin } from '@/lib/accounts/sign-in.ts';
import { describeUsageWaitToggled } from '@/lib/accounts/usage-wait.ts';
import { describeFailure, requestWithToast, sendCommandWithToast } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';
import { connection } from '@/lib/connection/socket.ts';
import { createSignal } from '@/lib/signal.ts';

const CLOSED: SignInDialogState = {
  open: false,
  accountId: null,
  importing: null,
  loginId: null,
  failure: null,
};

const dialogSignal = createSignal();

let dialog = CLOSED;

function updateDialog(patch: Partial<SignInDialogState>) {
  dialog = { ...dialog, ...patch };
  dialogSignal.publish();
}

async function requestAccounts(path: string, body: unknown) {
  const answer = await requestJson<AccountsSnapshot>(path, body);
  connection.replaceAccounts(answer);
  return answer;
}

function updateAccounts(path: string, body: unknown, done?: string) {
  return requestWithToast(() => requestAccounts(path, body), done);
}

export function useAccounts() {
  return useSyncExternalStore(connection.subscribeAccounts, connection.selectAccounts);
}

const usageRecheck = createUsageRecheck({
  refresh: () => requestAccounts('/api/accounts/refresh', {}),
  read: () => requestAccounts('/api/accounts/refresh', { scope: 'usage' }),
});

export function refreshUsage() {
  return requestWithToast(async () => {
    const result = await usageRecheck.check();
    if (!result.ok) throw result.error;
  });
}

export function watchUsage() {
  return usageRecheck.watch();
}

export function resetUsageRecheck() {
  usageRecheck.reset();
}

export function submitLoginCode(loginId: string, code: string) {
  return updateAccounts('/api/accounts/login/code', { loginId, code });
}

function cancelLogin(loginId: string) {
  return updateAccounts('/api/accounts/login/cancel', { loginId });
}

export function importAccount(entry: AccountImport) {
  return startImportSignIn(entry.email);
}

export function updateAccount(accountId: string, patch: AccountPatch, done: string) {
  return updateAccounts('/api/accounts/update', { accountId, patch }, done);
}

export function removeAccount(accountId: string) {
  return updateAccounts('/api/accounts/remove', { accountId }, 'Account removed.');
}

async function openSignIn(
  start: Pick<SignInDialogState, 'accountId' | 'importing'>,
  request: () => Promise<AccountsSnapshot>
) {
  updateDialog({ open: true, ...start, loginId: null, failure: null });
  try {
    const answer = await request();
    updateDialog({ loginId: answer.login?.id ?? null });
  } catch (error) {
    updateDialog({ failure: describeFailure(error) });
  }
}

export function startSignIn(accountId: string | null = null) {
  return openSignIn({ accountId, importing: null }, () =>
    requestAccounts('/api/accounts/login', accountId ? { accountId } : {})
  );
}

function startImportSignIn(email: string) {
  return openSignIn({ accountId: null, importing: email }, () =>
    requestAccounts('/api/accounts/import', { origin: 'cswap', email })
  );
}

export function retrySignIn() {
  if (dialog.importing !== null) return startImportSignIn(dialog.importing);
  return startSignIn(dialog.accountId);
}

export function closeSignIn() {
  const login = selectDialogLogin(dialog, connection.selectAccounts());
  dialog = CLOSED;
  dialogSignal.publish();
  if (login) void cancelLogin(login.id);
}

export function useSignInDialog() {
  return useSyncExternalStore(dialogSignal.subscribe, () => dialog);
}

export function bindTaskAccount(taskId: string, account: RunAccount | null) {
  return sendCommandWithToast({ type: 'task.bind_account', taskId, account }, describeBinding(account));
}

export function rerunStep(taskId: string, account: RunAccount) {
  return sendCommandWithToast({ type: 'task.retry', taskId, account }, describeRerun(account));
}

export function resumeUsageWaitNow(taskId: string) {
  return sendCommandWithToast({ type: 'usage_wait.resume_now', taskId }, 'Resuming now.');
}

export function updateUsageWait(taskId: string, autoResume: boolean) {
  return sendCommandWithToast(
    { type: 'usage_wait.change', taskId, autoResume },
    describeUsageWaitToggled(autoResume)
  );
}
