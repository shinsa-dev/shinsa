import { Option } from 'effect';
import { resolvePlanKey } from '../accounts/plan.ts';
import { isModelMarkFor } from '../accounts/usage.ts';
import {
  CLAUDE_PROVIDER,
  RUN_AGENT_ROLE,
  resolveAgentModel,
  resolveAgentProvider,
  resolveProviderLabel,
} from '../agent-models/index.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  type Gate,
  isTaskClosed,
  MINUTE_MS,
  OWNER_SIGNED_OUT_CODE,
  resolveFirstName,
  RUN_STAGES,
  type Run,
  type RunAccount,
  type RunFailure,
  type Task,
  type TaskOwner,
  type UsageWait,
} from '../domain/index.ts';
import { isPaceMoved, resolveRecordablePace } from '../forecast/index.ts';
import { resolveUsageResumeNudge } from '../prompts/session.ts';
import { listOpenGates } from '../state/queries.ts';
import { releasePaceWait } from './costs.ts';
import type { Decider } from './decider.ts';
import { retryTask } from './retry.ts';
import { moveWatchCheck } from './watchdogs.ts';

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
  if (isTaskClosed(task))
    throw new DomainError({ code: 'task_settled', message: 'This task is finished. Start a new one.' });
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
    model: failure.model ?? run.model,
    limitScope: failure.limitScope ?? 'account',
  };
  decider.emit({ type: 'usage_wait.armed', taskId: task.id, wait });
  decider.stage(task.id, task.stage, autoResume ? WAITING : PAUSED_UNTIL_RESET);
  return true;
}

function findArmedWait(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const wait = task.usageWait;
  if (wait?.status !== 'armed') {
    throw new DomainError({ code: 'usage_wait_missing', message: 'Nothing here waits for a usage reset.' });
  }
  return { task, wait };
}

function resumeFromWait(decider: Decider, task: Task, wait: UsageWait) {
  const run = decider.state.runs[wait.runId] ?? null;
  decider.emit({ type: 'usage_wait.ended', taskId: task.id, waitId: wait.id, status: 'resumed' });
  const prompt = run?.rolePrompt ?? run?.prompt ?? '';
  const next = decider.startRun(decider.task(task.id), wait.role, `${prompt}${resolveUsageResumeNudge()}`, {
    resumeFrom: decider.resumableFrom(run),
    purpose: run?.purpose ?? null,
    phaseIndex: wait.phaseIndex,
    monitorId: run?.monitorId ?? null,
    usageWaitId: wait.id,
    account: run?.account ?? null,
    continues: wait.runId,
  });
  moveWatchCheck(decider, wait.runId, next.id);
}

function isModelMoved(decider: Decider, wait: UsageWait) {
  const { settings } = decider.state;
  const role = RUN_AGENT_ROLE[wait.role];
  const provider = resolveAgentProvider(settings, role);
  if (provider !== (wait.provider ?? CLAUDE_PROVIDER)) return true;
  return !isModelMarkFor(wait.model, resolveAgentModel(settings, role, provider));
}

export function releaseModelWaits(decider: Decider) {
  for (const task of Object.values(decider.state.tasks)) {
    const wait = task.usageWait;
    if (wait?.status !== 'armed' || wait.cause === 'pace' || wait.limitScope !== 'model') continue;
    if (RUN_STAGES.has(task.stage) && isModelMoved(decider, wait)) resumeFromWait(decider, task, wait);
  }
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
  if (decider.context.now < wait.resetAt || wait.pace?.scope === 'admission') return;
  if (wait.cause === 'pace') {
    releasePaceWait(decider, task, wait);
    return;
  }
  if (wait.autoResume) {
    resumeFromWait(decider, task, wait);
    return;
  }
  decider.emit({ type: 'usage_wait.ended', taskId: task.id, waitId: wait.id, status: 'reset' });
  decider.fail(task.id, 'The usage limit has reset', describeReset(wait), wait.runId);
}

function canIgnorePaceLimits(decider: Decider) {
  const { onBehalf, guest } = decider.context;
  return !onBehalf && !guest;
}

export function resumeUsageWaitNow(decider: Decider, command: CommandOf<'usage_wait.resume_now'>) {
  const { task, wait } = findArmedWait(decider, command.taskId);
  if (wait.cause === 'pace') {
    if (canIgnorePaceLimits(decider)) decider.emit({ type: 'task.pace_limits_ignored', taskId: task.id });
    releasePaceWait(decider, task, wait);
    return;
  }
  resumeFromWait(decider, task, wait);
}

export function changeUsageWait(decider: Decider, command: CommandOf<'usage_wait.change'>) {
  const { task, wait } = findArmedWait(decider, command.taskId);
  if (wait.cause === 'pace') {
    throw new DomainError({
      code: 'usage_wait_pace',
      message: 'A step held at a usage limit always starts by itself. Resume it now, or raise the limit.',
    });
  }
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

function describeOwnerSignIn(owner: TaskOwner | null) {
  const who = owner ? resolveFirstName(owner) : 'You';
  const verb = owner ? 'needs' : 'need';
  return {
    title: `Paused: ${who} ${verb} a Claude account on this machine`,
    reason: owner
      ? `This is a shared machine, so the task runs only on ${who}'s own Claude accounts, and ${who} has none signed in here. ${who} can sign one in from Settings → Accounts. Signing in starts the step again.`
      : `This is a shared machine, so the task runs only on its owner's Claude accounts, and you have none signed in here. Signing in starts the step again.`,
  };
}

function requestOwnerSignIn(decider: Decider, run: Run, task: Task) {
  const { title, reason } = describeOwnerSignIn(task.owner ?? null);
  decider.openGate(task.id, 'sign_in', title, reason, {
    runId: run.id,
    details: { provider: CLAUDE_PROVIDER, account: null, cause: 'owner_account' },
  });
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
  const owned = failure.code === OWNER_SIGNED_OUT_CODE;
  const signIn = owned ? null : resolveSignIn(run, failure);
  if (!owned && !signIn) return false;
  const task = decider.task(run.taskId);
  decider.cancelRuns(task.id);
  decider.clearWaits(task.id);
  if (!signIn) {
    requestOwnerSignIn(decider, run, task);
    return true;
  }
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
  const gates = listSignInGates(
    decider,
    (gate) => gate.account?.id === command.account.id || gate.cause === 'owner_account'
  );
  for (const gate of gates) retryAfterSignIn(decider, gate);
}

export function recordProviderSignIn(decider: Decider, command: CommandOf<'provider.record_sign_in'>) {
  const gates = listSignInGates(decider, (gate) => gate.provider === command.provider && !gate.account);
  for (const gate of gates) retryAfterSignIn(decider, gate);
}

export function recordAccountPlan(decider: Decider, command: CommandOf<'account.plan_recorded'>) {
  const plan = Option.getOrNull(resolvePlanKey(command.plan));
  const known = decider.state.accountPlans[command.accountId];
  if (!known && !plan) return;
  if (known?.plan === plan && known.provider === command.provider) return;
  decider.emit({
    type: 'account.plan_recorded',
    accountId: command.accountId,
    provider: command.provider,
    plan,
  });
}

export function recordUsagePace(decider: Decider, command: CommandOf<'usage.pace_recorded'>) {
  const known = decider.state.usagePaces[command.provider]?.pace ?? null;
  if (!isPaceMoved(known, command.pace)) return;
  decider.emit({
    type: 'usage.pace_recorded',
    provider: command.provider,
    pace: Option.getOrNull(resolveRecordablePace(command.pace)),
  });
}

export function recordAccountRemoved(decider: Decider, command: CommandOf<'account.removed'>) {
  const known = decider.state.accountPlans[command.accountId];
  if (known) {
    decider.emit({
      type: 'account.plan_recorded',
      accountId: command.accountId,
      provider: known.provider,
      plan: null,
    });
  }
  for (const task of Object.values(decider.state.tasks)) {
    if (task.account?.id !== command.accountId || isTaskClosed(task)) continue;
    decider.emit({ type: 'task.account_bound', taskId: task.id, account: null, by: 'shinsa' });
  }
  const gates = listSignInGates(decider, (gate) => gate.account?.id === command.accountId);
  for (const gate of gates) retryAfterSignIn(decider, gate);
}
