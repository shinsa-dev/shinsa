import type { RunRole, RunUsage, Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveUsageShares, type UsageShareState } from './rate.ts';

export {
  resolveMeterWindow,
  resolveUsageRates,
  resolveUsageShares,
  USAGE_RATE_LIMITS,
  type UsageRate,
} from './rate.ts';

export interface CostLine {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  tokens: number;
  knownUsd: number;
  unpricedRuns: number;
  weeklyPercent: number;
  weeklyRuns: number;
  weeklyTasks: number;
  learningRuns: number;
  estimatedPercent: number;
}

export interface TaskCost {
  total: CostLine;
  byRole: { role: RunRole; cost: CostLine }[];
  byPhase: { index: number; title: string; cost: CostLine }[];
}

export type BudgetUnit = 'percent' | 'usd';

export interface TaskBudget {
  unit: BudgetUnit;
  cap: number;
  limit: number;
  spent: number;
  share: number;
  estimated: boolean;
}

const ROLE_RANK: Record<RunRole, number> = {
  agent: 1,
  answerer: 2,
  investigator: 3,
  researcher: 4,
  reviewer: 5,
  planner: 6,
  builder: 7,
};

function createLine(): CostLine {
  return {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokens: 0,
    knownUsd: 0,
    unpricedRuns: 0,
    weeklyPercent: 0,
    weeklyRuns: 0,
    weeklyTasks: 0,
    learningRuns: 0,
    estimatedPercent: 0,
  };
}

function addRun(line: CostLine, usage: RunUsage, share: UsageShareState | undefined): CostLine {
  const known = typeof share === 'object' && share.trusted ? share : null;
  const estimate = typeof share === 'object' && !share.trusted ? share.percent : 0;
  return {
    runs: line.runs + 1,
    inputTokens: line.inputTokens + usage.inputTokens,
    outputTokens: line.outputTokens + usage.outputTokens,
    cacheReadTokens: line.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: line.cacheWriteTokens + usage.cacheWriteTokens,
    tokens:
      line.tokens + usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
    knownUsd: line.knownUsd + (usage.costUsd ?? 0),
    unpricedRuns: line.unpricedRuns + (usage.costUsd === null ? 1 : 0),
    weeklyPercent: line.weeklyPercent + (known?.percent ?? 0),
    weeklyRuns: line.weeklyRuns + (known ? 1 : 0),
    weeklyTasks: Math.max(line.weeklyTasks, known?.tasks ?? 0),
    learningRuns: line.learningRuns + (share !== undefined && !known ? 1 : 0),
    estimatedPercent: line.estimatedPercent + estimate,
  };
}

function less(value: number, baseline: number) {
  return Math.max(0, value - baseline);
}

export function addUsage(total: RunUsage | null | undefined, usage: RunUsage): RunUsage {
  if (!total) return usage;
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
    costUsd: total.costUsd === null || usage.costUsd === null ? null : total.costUsd + usage.costUsd,
  };
}

export function resolveUsageDelta(previous: RunUsage | null, total: RunUsage): RunUsage {
  if (!previous) return total;
  return {
    inputTokens: less(total.inputTokens, previous.inputTokens),
    outputTokens: less(total.outputTokens, previous.outputTokens),
    cacheReadTokens: less(total.cacheReadTokens, previous.cacheReadTokens),
    cacheWriteTokens: less(total.cacheWriteTokens, previous.cacheWriteTokens),
    costUsd:
      total.costUsd === null || previous.costUsd === null ? null : less(total.costUsd, previous.costUsd),
  };
}

export function resolveTaskCost(state: ShinsaState, task: Task): TaskCost {
  const shares = resolveUsageShares(state.runs);
  const runs = Object.values(state.runs).filter((run) => run.taskId === task.id);
  const plan = task.plan?.document?.phases ?? [];
  const byRole = new Map<RunRole, CostLine>();
  const byPhase = new Map<number, CostLine>();
  let total = createLine();
  for (const run of runs) {
    if (!run.usage) continue;
    const share = shares.get(run.id);
    total = addRun(total, run.usage, share);
    byRole.set(run.role, addRun(byRole.get(run.role) ?? createLine(), run.usage, share));
    if (run.purpose === 'build' && typeof run.phaseIndex === 'number') {
      byPhase.set(run.phaseIndex, addRun(byPhase.get(run.phaseIndex) ?? createLine(), run.usage, share));
    }
  }
  return {
    total,
    byRole: [...byRole.entries()]
      .sort(([a], [b]) => ROLE_RANK[a] - ROLE_RANK[b])
      .map(([role, cost]) => ({ role, cost })),
    byPhase: [...byPhase.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, cost]) => ({ index, title: plan[index]?.title ?? `Phase ${index + 1}`, cost })),
  };
}

function createBudget(
  unit: BudgetUnit,
  cap: number,
  acknowledged: number,
  spent: number,
  estimated = false
): TaskBudget {
  const limit = acknowledged + cap;
  return { unit, cap, limit, spent, share: spent / limit, estimated };
}

export function listTaskBudgets(state: ShinsaState, task: Task): TaskBudget[] {
  const { taskUsageLimit, taskBudgetUsd } = state.settings;
  if (taskUsageLimit == null && taskBudgetUsd == null) return [];
  const { total } = resolveTaskCost(state, task);
  const budgets: TaskBudget[] = [];
  if (taskUsageLimit != null) {
    budgets.push(
      createBudget(
        'percent',
        taskUsageLimit,
        task.usageAcknowledgedPercent ?? 0,
        total.weeklyPercent + total.estimatedPercent,
        total.learningRuns > 0
      )
    );
  }
  if (taskBudgetUsd != null) {
    budgets.push(createBudget('usd', taskBudgetUsd, task.budgetAcknowledgedUsd ?? 0, total.knownUsd));
  }
  return budgets;
}

export function listSpentBudgets(state: ShinsaState, task: Task) {
  return listTaskBudgets(state, task).filter((budget) => budget.spent >= budget.limit);
}

export function selectSpentBudget(state: ShinsaState, task: Task) {
  return listSpentBudgets(state, task)[0] ?? null;
}

export function isOverBudget(state: ShinsaState, task: Task) {
  return selectSpentBudget(state, task) !== null;
}

export function describeUsd(value: number) {
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

export function describeWeeklyPercent(value: number) {
  if (value > 0 && value < 0.1) return '<0.1%';
  if (value < 10) return `${Number(value.toFixed(1))}%`;
  return `${Math.round(value)}%`;
}

export function resolveCostUnit(line: CostLine): BudgetUnit {
  return line.weeklyRuns > 0 && line.weeklyRuns + line.unpricedRuns >= line.runs ? 'percent' : 'usd';
}

export function describeBudgetAmount(budget: Pick<TaskBudget, 'unit'>, value: number) {
  return budget.unit === 'usd' ? describeUsd(value) : describeWeeklyPercent(value);
}
