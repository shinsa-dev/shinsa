import {
  type CostLine,
  describeBudgetAmount,
  describeWeeklyPercent,
  listTaskBudgets,
  resolveTaskCost,
  type ShinsaState,
  selectSpentBudget,
  type Task,
  type TaskBudget,
} from '@shinsa/core';
import { RUN_ROLE } from '@/lib/chat/run-role.ts';
import { formatCost, formatTokens } from '@/lib/format/money.ts';

interface CostRow {
  key: string;
  label: string;
  cost: string;
  tokens: string;
}

interface CostFacts {
  total: string;
  heading: string;
  detail: string;
  budget: { share: number; over: boolean } | null;
  byRole: CostRow[];
  byPhase: CostRow[];
}

export function describeBudgetRetry(state: ShinsaState, task: Task) {
  const budget = selectSpentBudget(state, task);
  return budget && `Allow another ${describeBudgetAmount(budget, budget.cap)}`;
}

export function describeSpent(state: ShinsaState, task: Task) {
  const cost = resolveTaskCost(state, task).total;
  return cost.runs === 0 ? null : `${formatCost(cost)} so far`;
}

function toRow(key: string, label: string, line: CostLine): CostRow {
  return { key, label, cost: formatCost(line), tokens: formatTokens(line.tokens) };
}

function describeBudgetHeading(budget: TaskBudget) {
  const spent = describeBudgetAmount(budget, budget.spent);
  const limit = describeBudgetAmount(budget, budget.limit);
  return budget.unit === 'usd' ? `${spent} of ${limit}` : `${spent} of the weekly limit, ${limit} allowed`;
}

function describeTotal(total: string, line: CostLine) {
  if (line.weeklyPercent === 0) return total;
  return `${total} · ${describeWeeklyPercent(line.weeklyPercent)} of the weekly limit`;
}

export function resolveCostFacts(state: ShinsaState, task: Task): CostFacts | null {
  const cost = resolveTaskCost(state, task);
  if (cost.total.runs === 0) return null;
  const budget = selectSpentBudget(state, task) ?? listTaskBudgets(state, task)[0] ?? null;
  const total = formatCost(cost.total);
  const tokens = formatTokens(cost.total.tokens);
  return {
    total,
    heading: budget ? describeBudgetHeading(budget) : describeTotal(total, cost.total),
    detail:
      cost.total.unpricedRuns > 0
        ? `${tokens}. Some steps ran on a model without a known price.`
        : `${tokens}, as estimated by the agent provider.`,
    budget: budget && { share: Math.min(1, budget.share), over: budget.spent >= budget.limit },
    byRole: cost.byRole.map(({ role, cost: line }) => toRow(role, RUN_ROLE[role].name, line)),
    byPhase: cost.byPhase.map(({ index, title, cost: line }) => toRow(`phase-${index}`, title, line)),
  };
}
