import type { CommandOf } from '../commands/index.ts';
import {
  describeBudgetAmount,
  isOverBudget,
  listSpentBudgets,
  resolveUsageDelta,
  selectSpentBudget,
  type TaskBudget,
} from '../costs/index.ts';
import { DomainError, type Gate, type Run, type RunUsage } from '../domain/index.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { retryTask } from './retry.ts';

function isTokenCount(value: number) {
  return Number.isInteger(value) && value >= 0;
}

function assertUsage(usage: RunUsage) {
  const counts = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens];
  const cost = usage.costUsd;
  if (!counts.every(isTokenCount) || (cost !== null && !(Number.isFinite(cost) && cost >= 0))) {
    throw new DomainError('usage_invalid', 'Token counts and cost must be zero or more.');
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

function assertWeeklyPercent(value: number | undefined) {
  if (value !== undefined && !(Number.isFinite(value) && value >= 0 && value <= 100)) {
    throw new DomainError('usage_invalid', 'The weekly usage a run used must be a percentage from 0 to 100.');
  }
}

export function meterRun(decider: Decider, command: CommandOf<'run.meter'>) {
  if (!decider.state.runs[command.runId]) return;
  assertUsage(command.usage);
  assertWeeklyPercent(command.weeklyPercent);
  const weekly = command.weeklyPercent ? { weeklyPercent: command.weeklyPercent } : {};
  const sessionId = command.sessionId ?? null;
  if (sessionId === null) {
    decider.emit({ type: 'run.metered', runId: command.runId, usage: command.usage, ...weekly });
    return;
  }
  const previous = decider.state.sessionUsage[sessionId] ?? null;
  if (previous && isSameUsage(previous, command.usage) && !command.weeklyPercent) return;
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

function describeSpent(budget: TaskBudget) {
  const spent = describeBudgetAmount(budget, budget.spent);
  return budget.unit === 'usd' ? spent : `${spent} of the weekly usage limit`;
}

export function holdForBudget(decider: Decider, run: Run) {
  const task = decider.task(run.taskId);
  const budget = selectSpentBudget(decider.state, task);
  if (!budget) return false;
  decider.fail(
    task.id,
    BUDGET_TITLE[budget.unit],
    `This task has used ${describeSpent(budget)}, past its ${describeBudgetAmount(budget, budget.limit)} limit, so the next step did not start. Continue to allow another ${describeBudgetAmount(budget, budget.cap)}, or cancel the task.`,
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

export function releaseBudgetHolds(decider: Decider) {
  const released = listOpenGates(decider.state).filter(
    (gate) => gate.cause === 'budget' && !isOverBudget(decider.state, decider.task(gate.taskId))
  );
  for (const gate of released) retryTask(decider, gate.taskId, null);
}
