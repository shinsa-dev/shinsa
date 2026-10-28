import { CLAUDE_PROVIDER, resolveProviderLabel } from '../agent-models/index.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  type Gate,
  isTaskClosed,
  MINUTE_MS,
  RUN_STAGES,
  type Run,
  type RunAccount,
  type RunFailure,
  type Task,
  type UsageWait,
} from '../domain/index.ts';
import { resolveUsageResumeNudge } from '../prompts/session.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { retryTask } from './retry.ts';

const WAITING = 'waiting for the usage limit to reset';

const PAUSED_UNTIL_RESET = 'paused until the usage limit resets';

const ESTIMATED_RESET_MS = 15 * MINUTE_MS;

const SIGNED_OUT_CODES: ReadonlySet<string> = new Set([
  'login_required',
  'authentication_failed',
  'api_error_401',
]);

function isSameAccount(a: RunAccount | null | undefined, b: RunAccount | null | undefined) {
  return (a?.id ?? null) === (b?.id ?? null) && (a?.email ?? null) === (b?.email ?? null);
}

export function bindAccount(decider: Decider, command: CommandOf<'task.bind_account'>) {
  const task = decider.task(command.taskId);
  if (isTaskClosed(task)) throw new DomainError('task_settled', 'This task is finished. Start a new one.');
  if (isSameAccount(task.account, command.account)) return;
  decider.emit({ type: 'task.account_bound', taskId: task.id, account: command.account });
}

function isUsageWaitLoop(task: Task, run: Run, resetAt: number) {
  const previous = task.usageWait;
  return Boolean(run.usageWaitId && previous?.id === run.usageWaitId && resetAt <= previous.resetAt);
}

function resolveWaitUntil(task: Task, run: Run, resetAt: number | null, now: number) {
  const estimate = now + ESTIMATED_RESET_MS;
  if (resetAt === null || resetAt <= now) return estimate;
  return isUsageWaitLoop(task, run, resetAt) ? Math.max(resetAt, estimate) : resetAt;
}

export function waitForUsageReset(decider: Decider, run: Run, failure: RunFailure) {
  const settings = decider.state.settings;
  const autoResume = settings.autoResume ?? true;
  if (!autoResume && !(settings.snoozeLimited ?? true)) return false;
  const task = decider.task(run.taskId);
  const resetAt = resolveWaitUntil(task, run, failure.resetAt, decider.context.now);
  const wait: UsageWait = {
    id: decider.context.newId(),
    runId: run.id,
    role: run.role,
    phaseIndex: run.phaseIndex ?? null,
    account: failure.account ?? null,
    resetAt,
    armedAt: decider.context.now,
    autoResume,
    status: 'armed',
    provider: run.attempts?.at(-1)?.provider ?? run.provider,
  };
  decider.emit({ type: 'usage_wait.armed', taskId: task.id, wait });
  decider.stage(task.id, task.stage, autoResume ? WAITING : PAUSED_UNTIL_RESET);
  return true;
}

function findArmedWait(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const wait = task.usageWait;
  if (wait?.status !== 'armed') {
    throw new DomainError(
      'usage_wait_missing',
      'Nothing on this task is waiting for a usage limit to reset.'
    );
  }
  return { task, wait };
}

function resumeFromWait(decider: Decider, task: Task, wait: UsageWait) {
  const run = decider.state.runs[wait.runId] ?? null;
  decider.emit({ type: 'usage_wait.ended', taskId: task.id, waitId: wait.id, status: 'resumed' });
  const prompt = run?.rolePrompt ?? run?.prompt ?? '';
  decider.startRun(decider.task(task.id), wait.role, `${prompt}${resolveUsageResumeNudge()}`, {
    resumeFrom: decider.resumableFrom(run),
    purpose: run?.purpose ?? null,
    phaseIndex: wait.phaseIndex,
    monitorId: run?.monitorId ?? null,
    usageWaitId: wait.id,
    account: run?.account ?? null,
  });
}

function describeReset(wait: UsageWait) {
  const account = wait.account?.email ? ` on ${wait.account.email}` : '';
  const provider = resolveProviderLabel(wait.provider ?? CLAUDE_PROVIDER);
  return `The agent stopped at the ${provider} usage limit${account}. The limit has reset. Retry to carry on, or cancel the task.`;
}

export function resumeUsageWait(decider: Decider, command: CommandOf<'usage_wait.resume'>) {
  const task = decider.state.tasks[command.taskId];
  const wait = task?.usageWait;
  if (!task || !RUN_STAGES.has(task.stage) || wait?.id !== command.waitId || wait.status !== 'armed') return;
  if (decider.context.now < wait.resetAt) return;
  if (wait.autoResume) {
    resumeFromWait(decider, task, wait);
    return;
  }
  decider.emit({ type: 'usage_wait.ended', taskId: task.id, waitId: wait.id, status: 'reset' });
  decider.fail(task.id, 'The usage limit has reset', describeReset(wait), wait.runId);
}

export function resumeUsageWaitNow(decider: Decider, command: CommandOf<'usage_wait.resume_now'>) {
  const { task, wait } = findArmedWait(decider, command.taskId);
  resumeFromWait(decider, task, wait);
}

export function changeUsageWait(decider: Decider, command: CommandOf<'usage_wait.change'>) {
  const { task, wait } = findArmedWait(decider, command.taskId);
  if (wait.autoResume === command.autoResume) return;
  const changed: UsageWait = { ...wait, id: decider.context.newId(), autoResume: command.autoResume };
  decider.emit({ type: 'usage_wait.armed', taskId: task.id, wait: changed });
  decider.stage(task.id, task.stage, command.autoResume ? WAITING : PAUSED_UNTIL_RESET);
}

function describeSignIn(provider: string, email: string | null) {
  return `Paused: ${email ?? resolveProviderLabel(provider)} needs signing in`;
}

function describeSignInReason(failure: RunFailure, provider: string) {
  const reason = SIGNED_OUT_CODES.has(failure.code ?? '')
    ? `${resolveProviderLabel(provider)} signed this account out, so the agent stopped.`
    : failure.message;
  return `${reason} Signing in starts the step again.`;
}

function resolveSignIn(run: Run, failure: RunFailure) {
  const provider = run.attempts?.at(-1)?.provider ?? run.provider;
  if (failure.account && provider === CLAUDE_PROVIDER) {
    return { provider, account: failure.account, email: failure.account.email };
  }
  if (failure.login) return { provider: failure.login.provider, account: null, email: failure.login.email };
  return null;
}

export function requestSignIn(decider: Decider, run: Run, failure: RunFailure) {
  const signIn = resolveSignIn(run, failure);
  if (!signIn) return false;
  const task = decider.task(run.taskId);
  decider.cancelRuns(task.id);
  decider.clearWaits(task.id);
  const title = describeSignIn(signIn.provider, signIn.email);
  decider.openGate(task.id, 'sign_in', title, describeSignInReason(failure, signIn.provider), {
    runId: run.id,
    details: { provider: signIn.provider, account: signIn.account },
  });
  return true;
}

function listSignInGates(decider: Decider, matches: (gate: Gate) => boolean) {
  return listOpenGates(decider.state).filter((gate) => gate.type === 'sign_in' && matches(gate));
}

function retryAfterSignIn(decider: Decider, gate: Gate) {
  decider.emit({ type: 'gate.answered', gateId: gate.id, decision: 'approve', response: null });
  decider.requestBriefing(gate.taskId);
  decider.resetRecoveries(gate.taskId);
  retryTask(decider, gate.taskId, null);
}

export function recordSignedIn(decider: Decider, command: CommandOf<'account.signed_in'>) {
  const gates = listSignInGates(decider, (gate) => gate.account?.id === command.account.id);
  for (const gate of gates) retryAfterSignIn(decider, gate);
}

export function recordProviderSignIn(decider: Decider, command: CommandOf<'provider.record_sign_in'>) {
  const gates = listSignInGates(decider, (gate) => gate.provider === command.provider && !gate.account);
  for (const gate of gates) retryAfterSignIn(decider, gate);
}

export function recordAccountRemoved(decider: Decider, command: CommandOf<'account.removed'>) {
  for (const task of Object.values(decider.state.tasks)) {
    if (task.account?.id !== command.accountId || isTaskClosed(task)) continue;
    decider.emit({ type: 'task.account_bound', taskId: task.id, account: null, by: 'shinsa' });
  }
  const gates = listSignInGates(decider, (gate) => gate.account?.id === command.accountId);
  for (const gate of gates) retryAfterSignIn(decider, gate);
}
