import { Option } from 'effect';
import { CLAUDE_PROVIDER } from '../agent-models/index.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  type AdmissionVerdict,
  describeBudgetAmount,
  isBuildRun,
  isOverBudget,
  listBuildingTasks,
  type PaceHold,
  resolveAdmission,
  sortAdmissionQueue,
  listSpentBudgets,
  resolvePaceHold,
  resolveUsageDelta,
  selectSpentBudget,
  type TaskBudget,
} from '../costs/index.ts';
import {
  DomainError,
  type Gate,
  isDelegatedRun,
  isWatchHome,
  resolveAutoPace,
  resolveWatchdogsIgnoreUsageLimits,
  type Run,
  type RunUsage,
  type Task,
  type UsagePace,
  type UsagePaceScope,
  type UsageWait,
  type WeeklyReading,
} from '../domain/index.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { retryTask } from './retry.ts';
import { moveWatchCheck } from './watchdogs.ts';

function isTokenCount(value: number) {
  return Number.isInteger(value) && value >= 0;
}

function assertUsage(usage: RunUsage) {
  const counts = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens];
  const cost = usage.costUsd;
  if (!counts.every(isTokenCount) || (cost !== null && !(Number.isFinite(cost) && cost >= 0))) {
    throw new DomainError({ code: 'usage_invalid', message: 'Token counts and cost must be zero or more.' });
  }
}

function isSameUsage(a: RunUsage, b: RunUsage) {
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens &&
    a.costUsd === b.costUsd
  );
}

function isTime(value: number | null) {
  return value === null || (Number.isFinite(value) && value >= 0);
}

function assertReadings(readings: WeeklyReading[]) {
  const valid = readings.every(
    (reading) =>
      Number.isFinite(reading.percent) &&
      reading.percent >= 0 &&
      reading.percent <= 100 &&
      isTime(reading.at) &&
      isTime(reading.resetsAt)
  );
  if (!valid) {
    throw new DomainError({
      code: 'usage_invalid',
      message: 'A weekly reading must be a percentage from 0 to 100 with a time and a reset time or none.',
    });
  }
}

export function meterRun(decider: Decider, command: CommandOf<'run.meter'>) {
  if (!decider.state.runs[command.runId]) return;
  assertUsage(command.usage);
  const readings = command.readings ?? [];
  assertReadings(readings);
  const weekly = readings.length > 0 ? { readings } : {};
  const sessionId = command.sessionId ?? null;
  if (sessionId === null) {
    decider.emit({ type: 'run.metered', runId: command.runId, usage: command.usage, ...weekly });
    return;
  }
  const previous = decider.state.sessionUsage[sessionId] ?? null;
  if (previous && isSameUsage(previous, command.usage) && readings.length === 0) return;
  decider.emit({
    type: 'run.metered',
    runId: command.runId,
    usage: resolveUsageDelta(previous, command.usage),
    sessionId,
    sessionUsage: command.usage,
    ...weekly,
  });
}

const BUDGET_TITLE: Record<TaskBudget['unit'], string> = {
  percent: 'Reached its usage limit',
  usd: 'Reached its cost limit',
};

function describeLimit(budget: TaskBudget) {
  const limit = describeBudgetAmount(budget, budget.limit);
  return budget.unit === 'usd'
    ? `its ${limit} cost limit`
    : `its usage limit of ${limit} of the weekly limit`;
}

function describeEstimate(budget: TaskBudget) {
  return budget.estimated ? ' The share is an early estimate while Shinsa learns the account’s rate.' : '';
}

function isExemptWatchCheck(decider: Decider, run: Run) {
  return run.purpose === 'watch' && resolveWatchdogsIgnoreUsageLimits(decider.state.settings);
}

export function holdForBudget(decider: Decider, run: Run) {
  if (isExemptWatchCheck(decider, run)) return false;
  const task = decider.task(run.taskId);
  const spent = selectSpentBudget(decider.state, task);
  if (Option.isNone(spent)) return false;
  const budget = spent.value;
  decider.fail(
    task.id,
    BUDGET_TITLE[budget.unit],
    `This task reached ${describeLimit(budget)}, so the next step did not start.${describeEstimate(budget)} Continue to allow another ${describeBudgetAmount(budget, budget.cap)}, or cancel the task.`,
    null,
    'budget'
  );
  return true;
}

export function acknowledgeBudget(decider: Decider, gate: Gate) {
  if (gate.cause !== 'budget') return;
  const spent = listSpentBudgets(decider.state, decider.task(gate.taskId));
  const usd = spent.find((budget) => budget.unit === 'usd');
  const percent = spent.find((budget) => budget.unit === 'percent');
  if (!usd && !percent) return;
  decider.emit({
    type: 'budget.acknowledged',
    taskId: gate.taskId,
    ...(usd ? { spentUsd: usd.spent } : {}),
    ...(percent ? { spentPercent: percent.spent } : {}),
  });
}

function isExemptWatchTask(decider: Decider, task: Task) {
  return (
    task.stage === 'watching' &&
    !isWatchHome(task) &&
    resolveWatchdogsIgnoreUsageLimits(decider.state.settings)
  );
}

export function releaseBudgetHolds(decider: Decider) {
  const released = listOpenGates(decider.state).filter((gate) => {
    if (gate.cause !== 'budget') return false;
    const task = decider.task(gate.taskId);
    return isExemptWatchTask(decider, task) || !isOverBudget(decider.state, task);
  });
  for (const gate of released) retryTask(decider, gate.taskId, null);
}

const PACE_REASON: Record<UsagePaceScope, string> = {
  daily: 'held at the daily usage limit',
  project: 'held at the project’s usage limit',
  admission: 'waiting its turn to build within today’s usage',
};

const HELD_SUMMARY = 'Held at a usage limit before it started.';

function resolveHeldReason(task: Task, wait: UsageWait | null | undefined, run: Run) {
  return wait?.pace && wait.id === run.usageWaitId ? wait.pace.stageReason : task.stageReason;
}

function isStartedEarly(wait: UsageWait | null | undefined, run: Run, now: number) {
  return (
    wait?.cause === 'pace' &&
    wait.pace?.scope !== 'admission' &&
    wait.id === run.usageWaitId &&
    now < wait.resetAt
  );
}

function armPaceWait(decider: Decider, run: Run, limit: Omit<UsagePace, 'stageReason'>, freesAt: number) {
  const task = decider.task(run.taskId);
  const wait = task.usageWait;
  const { now } = decider.context;
  decider.endRun(run, 'cancelled', HELD_SUMMARY);
  decider.emit({
    type: 'usage_wait.armed',
    taskId: task.id,
    wait: {
      id: decider.context.newId(),
      runId: run.id,
      role: run.role,
      phaseIndex: run.phaseIndex ?? null,
      account: null,
      resetAt: freesAt,
      armedAt: now,
      autoResume: true,
      status: 'armed',
      provider: run.provider,
      cause: 'pace',
      pace: { ...limit, stageReason: resolveHeldReason(task, wait, run) },
    },
  });
  decider.stage(task.id, task.stage, PACE_REASON[limit.scope]);
}

export function holdForPace(decider: Decider, run: Run) {
  if (isDelegatedRun(run) || isExemptWatchCheck(decider, run)) return false;
  const task = decider.task(run.taskId);
  const { now } = decider.context;
  if (isStartedEarly(task.usageWait, run, now)) return false;
  const hold: Option.Option<PaceHold> = resolvePaceHold(decider.state, task, run.provider, now);
  if (Option.isNone(hold)) return false;
  const { freesAt, ...limit } = hold.value;
  armPaceWait(decider, run, limit, freesAt);
  return true;
}

function isAdmissionWait(wait: UsageWait | null | undefined): wait is UsageWait {
  return wait?.cause === 'pace' && wait.pace?.scope === 'admission' && wait.status === 'armed';
}

function listAdmissionWaits(decider: Decider) {
  return Object.values(decider.state.tasks).filter((task) => isAdmissionWait(task.usageWait));
}

function resolveAdmissionLimit(verdict: AdmissionVerdict): Omit<UsagePace, 'stageReason'> {
  return {
    scope: 'admission',
    limit: verdict.limit,
    percent: verdict.percent,
    projectId: null,
    need: verdict.need,
  };
}

function needsAdmission(decider: Decider, task: Task, run: Run) {
  return (
    resolveAutoPace(decider.state.settings) &&
    isBuildRun(run) &&
    !isDelegatedRun(run) &&
    !task.paceLimitsIgnored &&
    !listBuildingTasks(decider.state).has(task.id)
  );
}

export function holdForAdmission(decider: Decider, run: Run) {
  const task = decider.task(run.taskId);
  if (!needsAdmission(decider, task, run)) return false;
  const provider = run.provider ?? CLAUDE_PROVIDER;
  const admission = resolveAdmission(decider.state, task, provider, decider.context.now);
  if (Option.isNone(admission)) return false;
  const verdict = admission.value;
  const waiting = listAdmissionWaits(decider).filter(
    (other) => other.id !== task.id && (other.usageWait?.provider ?? CLAUDE_PROVIDER) === provider
  );
  const first = sortAdmissionQueue(decider.state, [...waiting, task], decider.context.now)[0];
  if (verdict.fits && first?.id === task.id) return false;
  const ahead = first && first.id !== task.id ? (first.usageWait?.resetAt ?? null) : null;
  armPaceWait(decider, run, resolveAdmissionLimit(verdict), resolveQueuedFreesAt(verdict, ahead));
  return true;
}

function resolveQueuedFreesAt(verdict: AdmissionVerdict, ahead: number | null) {
  return ahead === null ? verdict.freesAt : Math.max(verdict.freesAt, ahead);
}

function rearmAdmission(
  decider: Decider,
  task: Task,
  wait: UsageWait,
  admission: Option.Option<AdmissionVerdict>,
  ahead: number | null
) {
  const { now } = decider.context;
  if (wait.resetAt > now || Option.isNone(admission) || !wait.pace) return;
  const verdict = admission.value;
  decider.emit({
    type: 'usage_wait.armed',
    taskId: task.id,
    wait: {
      ...wait,
      resetAt: resolveQueuedFreesAt(verdict, ahead),
      pace: { ...wait.pace, ...resolveAdmissionLimit(verdict) },
    },
  });
}

export function admitBuilds(decider: Decider) {
  const waiting = listAdmissionWaits(decider);
  if (waiting.length === 0) return;
  const autoPace = resolveAutoPace(decider.state.settings);
  const blocked = new Map<string, number>();
  for (const queued of sortAdmissionQueue(decider.state, waiting, decider.context.now)) {
    const task = decider.task(queued.id);
    const wait = task.usageWait;
    if (!isAdmissionWait(wait)) continue;
    const provider = wait.provider ?? CLAUDE_PROVIDER;
    const verdict = autoPace
      ? resolveAdmission(decider.state, task, provider, decider.context.now)
      : Option.none<AdmissionVerdict>();
    const admitted = !autoPace || task.paceLimitsIgnored || Option.isNone(verdict) || verdict.value.fits;
    if (admitted && !blocked.has(provider)) {
      releasePaceWait(decider, task, wait);
      continue;
    }
    const ahead = blocked.get(provider) ?? null;
    rearmAdmission(decider, task, wait, verdict, ahead);
    if (ahead === null) blocked.set(provider, decider.task(task.id).usageWait?.resetAt ?? wait.resetAt);
  }
}

export function releasePaceWait(decider: Decider, task: Task, wait: UsageWait) {
  decider.emit({ type: 'usage_wait.ended', taskId: task.id, waitId: wait.id, status: 'resumed' });
  if (wait.pace) decider.stage(task.id, task.stage, wait.pace.stageReason);
  const held = decider.state.runs[wait.runId];
  if (!held) return;
  const run = decider.startRun(decider.task(task.id), held.role, held.rolePrompt ?? held.prompt ?? '', {
    resumeFrom: decider.resumableFrom(held),
    purpose: held.purpose ?? null,
    phaseIndex: held.phaseIndex ?? null,
    feedback: held.feedback ?? null,
    monitorId: held.monitorId ?? null,
    usageWaitId: wait.id,
    account: held.account ?? null,
    continues: held.id,
    told: held.told ?? null,
  });
  moveWatchCheck(decider, held.id, run.id);
}

export function releasePaceHolds(decider: Decider) {
  const { now } = decider.context;
  for (const task of Object.values(decider.state.tasks)) {
    const wait = task.usageWait;
    if (wait?.cause !== 'pace' || wait.status !== 'armed' || wait.pace?.scope === 'admission') continue;
    const held = decider.state.runs[wait.runId];
    const provider = wait.provider ?? CLAUDE_PROVIDER;
    const exempt = held !== undefined && isExemptWatchCheck(decider, held);
    if (exempt || Option.isNone(resolvePaceHold(decider.state, task, provider, now))) {
      releasePaceWait(decider, task, wait);
    }
  }
}
