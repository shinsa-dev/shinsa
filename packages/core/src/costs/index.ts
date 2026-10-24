import type { Run, RunRole, RunUsage, Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';

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
}

const ROLE_RANK: Record<RunRole, number> = {
  triage: 0,
  planner: 1,
  answerer: 2,
  investigator: 3,
  researcher: 4,
  operator: 5,
  builder: 6,
  reviewer: 7,
  fixer: 8,
  shipper: 9,
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
  };
}

function addRun(line: CostLine, run: Run): CostLine {
  const usage = run.usage;
  if (!usage) return { ...line, weeklyPercent: line.weeklyPercent + (run.weeklyPercent ?? 0) };
  const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return {
    runs: line.runs + 1,
    inputTokens: line.inputTokens + usage.inputTokens,
    outputTokens: line.outputTokens + usage.outputTokens,
    cacheReadTokens: line.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: line.cacheWriteTokens + usage.cacheWriteTokens,
    tokens: line.tokens + tokens,
    knownUsd: line.knownUsd + (usage.costUsd ?? 0),
    unpricedRuns: line.unpricedRuns + (usage.costUsd === null ? 1 : 0),
    weeklyPercent: line.weeklyPercent + (run.weeklyPercent ?? 0),
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
  const runs = Object.values(state.runs).filter(
    (run) => run.taskId === task.id && (run.usage || run.weeklyPercent !== undefined)
  );
  const plan = task.plan?.document?.phases ?? [];
  const byRole = new Map<RunRole, CostLine>();
  const byPhase = new Map<number, CostLine>();
  let total = createLine();
  for (const run of runs) {
    total = addRun(total, run);
    byRole.set(run.role, addRun(byRole.get(run.role) ?? createLine(), run));
    if (run.role === 'builder' && typeof run.phaseIndex === 'number') {
      byPhase.set(run.phaseIndex, addRun(byPhase.get(run.phaseIndex) ?? createLine(), run));
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

function createBudget(unit: BudgetUnit, cap: number, acknowledged: number, spent: number): TaskBudget {
  const limit = acknowledged + cap;
  return { unit, cap, limit, spent, share: spent / limit };
}

export function listTaskBudgets(state: ShinsaState, task: Task): TaskBudget[] {
  const { taskUsageLimit, taskBudgetUsd } = state.settings;
  if (taskUsageLimit == null && taskBudgetUsd == null) return [];
  const { total } = resolveTaskCost(state, task);
  const budgets: TaskBudget[] = [];
  if (taskUsageLimit != null) {
    budgets.push(
      createBudget('percent', taskUsageLimit, task.usageAcknowledgedPercent ?? 0, total.weeklyPercent)
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
  if (value > 0 && value < 1) return '<1%';
  return `${Math.round(value)}%`;
}

export function describeBudgetAmount(budget: Pick<TaskBudget, 'unit'>, value: number) {
  return budget.unit === 'usd' ? describeUsd(value) : describeWeeklyPercent(value);
}
