import type { RunAccount } from '../domain/index.ts';
import type { EventOf } from '../events/index.ts';
import { removeEntry, writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

function describeAccount(account: RunAccount) {
  return account.email ?? 'a Claude account';
}

export function applyAccountBound(state: ShinsaState, event: EventOf<'task.account_bound'>) {
  updateTask(state, event.taskId, event.at, { account: event.account });
  record(state, event.taskId, event.at, {
    actor: event.by ?? 'you',
    kind: 'account',
    text: event.account ? `Runs only on ${describeAccount(event.account)}` : 'Runs on any account',
  });
}

export function applyAccountPlan(state: ShinsaState, event: EventOf<'account.plan_recorded'>) {
  if (event.plan === null) {
    removeEntry(state, 'accountPlans', event.accountId);
    return;
  }
  writeEntry(state, 'accountPlans', event.accountId, {
    provider: event.provider,
    plan: event.plan,
    at: event.at,
  });
}
