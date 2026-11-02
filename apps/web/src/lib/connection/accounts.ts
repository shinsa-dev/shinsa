import type { AccountImport, AccountPatch, AccountsSnapshot, RunAccount } from '@shinsa/core';
import { Effect } from 'effect';
import { useSyncExternalStore } from 'react';
import { describeBinding, describeRerun } from '@/lib/accounts/account.ts';
import { createUsageRecheck } from '@/lib/accounts/recheck.ts';
import { type SignInDialogState, selectDialogLogin } from '@/lib/accounts/sign-in.ts';
import { describeUsageWaitToggled } from '@/lib/accounts/usage-wait.ts';
import { describeFailure, requestWithToast, sendCommandWithToast } from '@/lib/connection/commands.ts';
import { connection } from '@/lib/connection/socket.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSignal } from '@/lib/signal.ts';
import { UsageRecheckFailed } from './schema.ts';

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

type AccountEndpoints = EngineClient['Service']['accounts'];

function requestAccounts(call: (accounts: AccountEndpoints) => Effect.Effect<AccountsSnapshot, Error>) {
  return runApp(
    Effect.gen(function* () {
      const engine = yield* EngineClient;
      const answer = yield* call(engine.accounts);
      connection.replaceAccounts(answer);
      return answer;
    })
  );
}

function updateAccounts(
  call: (accounts: AccountEndpoints) => Effect.Effect<AccountsSnapshot, Error>,
  done?: string
) {
  return requestWithToast(() => requestAccounts(call), done);
}

export function useAccounts() {
  return useSyncExternalStore(connection.subscribeAccounts, connection.selectAccounts);
}

const usageRecheck = createUsageRecheck({
  refresh: () => requestAccounts((accounts) => accounts.refresh({ payload: {} })),
  read: () => requestAccounts((accounts) => accounts.refresh({ payload: { scope: 'usage' } })),
});

const recheckUsage = Effect.gen(function* () {
  const result = yield* Effect.promise(() => usageRecheck.check());
  if (!result.ok) return yield* new UsageRecheckFailed({ message: describeFailure(result.error) });
});

export function refreshUsage() {
  return requestWithToast(() => runApp(recheckUsage));
}

export function watchUsage() {
  return usageRecheck.watch();
}

export function resetUsageRecheck() {
  usageRecheck.reset();
}

export function submitLoginCode(loginId: string, code: string) {
  return updateAccounts((accounts) => accounts.loginCode({ payload: { loginId, code } }));
}

function cancelLogin(loginId: string) {
  return updateAccounts((accounts) => accounts.loginCancel({ payload: { loginId } }));
}

export function importAccount(entry: AccountImport) {
  return startImportSignIn(entry.email);
}

export function updateAccount(accountId: string, patch: AccountPatch, done: string) {
  return updateAccounts((accounts) => accounts.update({ payload: { accountId, patch } }), done);
}

export function removeAccount(accountId: string) {
  return updateAccounts((accounts) => accounts.remove({ payload: { accountId } }), 'Account removed.');
}

const openSignIn = Effect.fn('Accounts.openSignIn')(function* (
  start: Pick<SignInDialogState, 'accountId' | 'importing'>,
  call: (accounts: AccountEndpoints) => Effect.Effect<AccountsSnapshot, Error>
) {
  updateDialog({ open: true, ...start, loginId: null, failure: null });
  const engine = yield* EngineClient;
  const answer = yield* Effect.catch(call(engine.accounts), (error) =>
    Effect.sync(() => {
      updateDialog({ failure: describeFailure(error) });
      return null;
    })
  );
  if (answer === null) return;
  connection.replaceAccounts(answer);
  updateDialog({ loginId: answer.login?.id ?? null });
});

export function startSignIn(accountId: string | null = null) {
  return runApp(
    openSignIn({ accountId, importing: null }, (accounts) =>
      accounts.login({ payload: accountId ? { accountId } : {} })
    )
  );
}

function startImportSignIn(email: string) {
  return runApp(
    openSignIn({ accountId: null, importing: email }, (accounts) =>
      accounts.import({ payload: { origin: 'cswap', email } })
    )
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
