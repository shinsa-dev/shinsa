import {
  type BudgetUnit,
  type BuildEstimate,
  type CostLine,
  describeBudgetAmount,
  describeCount,
  describeWeeklyPercent,
  listTaskBudgets,
  describeUsd,
  resolveBuildEstimate,
  resolveCostUnit,
  resolveTaskCost,
  type ShinsaState,
  selectSpentBudget,
  type Task,
  type TaskBudget,
  type Percent,
  type Usd,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { Option } from 'effect';
import { RUN_ROLE } from '@/lib/chat/run-role.ts';
import { formatCost, formatTokens } from '@/lib/format/money.ts';

interface CostRow {
  key: string;
  label: string;
  cost: string;
  tokens: string;
}

interface EstimateRow {
  key: string;
  label: string;
  value: string;
}

interface CostFacts {
  icon: IconName;
  total: string;
  heading: string;
  detail: string;
  budget: { share: number; over: boolean } | null;
  byRole: CostRow[];
  byPhase: CostRow[];
  build: EstimateRow[] | null;
}

const UNIT_ICON: Record<BudgetUnit, IconName> = { percent: 'IconGauge', usd: 'IconCoins' };

export function describeBudgetRetry(state: ShinsaState, task: Task) {
  return Option.getOrNull(
    Option.map(
      selectSpentBudget(state, task),
      (budget) => `Allow another ${describeBudgetAmount(budget, 'cap')}`
    )
  );
}

function describeAmount(line: CostLine, unit: BudgetUnit) {
  return unit === 'percent' ? describeWeeklyPercent(line.weeklyPercent) : formatCost(line);
}

function toRow(key: string, label: string, line: CostLine, unit: BudgetUnit): CostRow {
  return { key, label, cost: describeAmount(line, unit), tokens: formatTokens(line.tokens) };
}

function describeBudgetHeading(budget: TaskBudget) {
  const spent = describeBudgetAmount(budget, 'spent');
  const limit = describeBudgetAmount(budget, 'limit');
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

function describeEstimateAmount(usd: Usd, percent: Option.Option<Percent>) {
  const amount = Option.match(percent, { onNone: () => describeUsd(usd), onSome: describeWeeklyPercent });
  return `About ${amount}`;
}

function describeEstimateBasis(estimate: BuildEstimate) {
  return estimate.samples > 0
    ? `What ${describeCount(estimate.samples, 'past build')} cost, by plan size`
    : 'The usual cost of a plan this size';
}

function listEstimateRows(state: ShinsaState, task: Task): EstimateRow[] | null {
  const estimate = Option.getOrNull(resolveBuildEstimate(state, task));
  if (!estimate || estimate.donePhases === estimate.phases) return null;
  const started = estimate.spentUsd > 0;
  return [
    { key: 'whole', label: 'Whole build', value: describeEstimateAmount(estimate.usd, estimate.percent) },
    ...(started
      ? [
          {
            key: 'left',
            label: 'Left to build',
            value: describeEstimateAmount(estimate.remainingUsd, estimate.remainingPercent),
          },
        ]
      : []),
    { key: 'basis', label: 'Based on', value: describeEstimateBasis(estimate) },
  ];
}

export function describeBuildEstimateFact(state: ShinsaState, task: Task) {
  const estimate = Option.getOrNull(resolveBuildEstimate(state, task));
  if (!estimate || estimate.donePhases === estimate.phases) return null;
  if (estimate.spentUsd === 0) return `${describeEstimateAmount(estimate.usd, estimate.percent)} to build`;
  return `${describeEstimateAmount(estimate.remainingUsd, estimate.remainingPercent)} left to build`;
}

function selectShownBudget(state: ShinsaState, task: Task, unit: BudgetUnit) {
  const spent = selectSpentBudget(state, task);
  if (Option.isSome(spent)) return spent.value;
  return listTaskBudgets(state, task).find((budget) => budget.unit === unit) ?? null;
}

export function resolveCostFacts(state: ShinsaState, task: Task): CostFacts | null {
  const cost = resolveTaskCost(state, task);
  if (cost.total.runs === 0) return null;
  const unit = resolveCostUnit(cost.total);
  const budget = selectShownBudget(state, task, unit);
  return {
    icon: UNIT_ICON[unit],
    total: describeAmount(cost.total, unit),
    heading: budget ? describeBudgetHeading(budget) : describeHeading(cost.total, unit),
    detail: describeDetail(cost.total, unit),
    budget: budget && { share: Math.min(1, budget.share), over: budget.spent >= budget.limit },
    byRole: cost.byRole.map(({ role, cost: line }) => toRow(role, RUN_ROLE[role].name, line, unit)),
    byPhase: cost.byPhase.map(({ index, title, cost: line }) => toRow(`phase-${index}`, title, line, unit)),
    build: listEstimateRows(state, task),
  };
}
