import {
  type BudgetUnit,
  type CostLine,
  describeBudgetAmount,
  describeCount,
  describeWeeklyPercent,
  listTaskBudgets,
  resolveCostUnit,
  resolveTaskCost,
  type ShinsaState,
  selectSpentBudget,
  type Task,
  type TaskBudget,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { RUN_ROLE } from '@/lib/chat/run-role.ts';
import { formatCost, formatTokens } from '@/lib/format/money.ts';

interface CostRow {
  key: string;
  label: string;
  cost: string;
  tokens: string;
}

interface CostFacts {
  icon: IconName;
  total: string;
  heading: string;
  detail: string;
  budget: { share: number; over: boolean } | null;
  byRole: CostRow[];
  byPhase: CostRow[];
}

const UNIT_ICON: Record<BudgetUnit, IconName> = { percent: 'IconGauge', usd: 'IconCoins' };

export function describeBudgetRetry(state: ShinsaState, task: Task) {
  const budget = selectSpentBudget(state, task);
  return budget && `Allow another ${describeBudgetAmount(budget, budget.cap)}`;
}

function describeAmount(line: CostLine, unit: BudgetUnit) {
  return unit === 'percent' ? describeWeeklyPercent(line.weeklyPercent) : formatCost(line);
}

export function describeSpent(state: ShinsaState, task: Task) {
  const cost = resolveTaskCost(state, task).total;
  if (cost.runs === 0) return null;
  const unit = resolveCostUnit(cost);
  const amount = describeAmount(cost, unit);
  return unit === 'percent' ? `${amount} of the weekly limit so far` : `${amount} so far`;
}

function toRow(key: string, label: string, line: CostLine, unit: BudgetUnit): CostRow {
  return { key, label, cost: describeAmount(line, unit), tokens: formatTokens(line.tokens) };
}

function describeBudgetHeading(budget: TaskBudget) {
  const spent = describeBudgetAmount(budget, budget.spent);
  const limit = describeBudgetAmount(budget, budget.limit);
  return budget.unit === 'usd' ? `${spent} of ${limit}` : `${spent} of the weekly limit, ${limit} allowed`;
}

function describeHeading(line: CostLine, unit: BudgetUnit) {
  const amount = describeAmount(line, unit);
  return unit === 'percent' ? `${amount} of the weekly limit` : amount;
}

function describeShareBasis(line: CostLine, unit: BudgetUnit) {
  if (unit === 'percent') {
    return ` The share is learned from ${describeCount(line.weeklyTasks, 'task')} on this account.`;
  }
  return line.learningRuns > 0
    ? ' The share of the weekly limit shows once a few more tasks have run on this account.'
    : '';
}

function describeDetail(line: CostLine, unit: BudgetUnit) {
  const tokens = formatTokens(line.tokens);
  const priced = line.unpricedRuns < line.runs;
  const amount = unit === 'percent' && priced ? `${formatCost(line)} and ${tokens}` : tokens;
  const provider =
    line.unpricedRuns > 0
      ? `${amount}. Some steps ran on a model without a known price.`
      : `${amount}, as estimated by the agent provider.`;
  return `${provider}${describeShareBasis(line, unit)}`;
}

function selectShownBudget(state: ShinsaState, task: Task, unit: BudgetUnit) {
  const spent = selectSpentBudget(state, task);
  if (spent) return spent;
  return listTaskBudgets(state, task).find((budget) => budget.unit === unit) ?? null;
}

export function resolveCostFacts(state: ShinsaState, task: Task): CostFacts | null {
  const cost = resolveTaskCost(state, task);
  if (cost.total.runs === 0) return null;
  const unit = resolveCostUnit(cost.total);
  const budget = selectShownBudget(state, task, unit);
  return {
    icon: UNIT_ICON[unit],
    total:
      unit === 'percent' ? `${describeAmount(cost.total, unit)} of weekly limit` : formatCost(cost.total),
    heading: budget ? describeBudgetHeading(budget) : describeHeading(cost.total, unit),
    detail: describeDetail(cost.total, unit),
    budget: budget && { share: Math.min(1, budget.share), over: budget.spent >= budget.limit },
    byRole: cost.byRole.map(({ role, cost: line }) => toRow(role, RUN_ROLE[role].name, line, unit)),
    byPhase: cost.byPhase.map(({ index, title, cost: line }) => toRow(`phase-${index}`, title, line, unit)),
  };
}
