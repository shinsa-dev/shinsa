import {
  describeUsd,
  resolveModelLabel,
  type Stats,
  type StatsBreakdown,
  type StatsDay,
  type StatsWork,
  sumTokenLines,
  type TaskTokens,
  type TokenLine,
  UNKNOWN_MODEL,
} from '@shinsa/core';
import { RUN_ROLE } from '@/lib/chat/run-role.ts';
import { formatCount } from '@/lib/format/count.ts';
import { formatTokenCount } from '@/lib/format/money.ts';
import { resolveChartMax } from './chart.ts';
import { formatShortDay } from './days.ts';
import type { ShippingTile } from './shipping.ts';
import { WEEKLY_AFTER_DAYS } from './shipping.ts';

export type TokenKind = 'cacheReadTokens' | 'cacheWriteTokens' | 'inputTokens' | 'outputTokens';

export interface TokenPoint {
  label: string;
  from: string;
  usage: TokenLine;
}

export interface TokenBar {
  label: string;
  from: string;
  tokens: number;
  segments: { kind: TokenKind; tokens: number }[];
}

export interface BreakdownRow {
  key: string;
  label: string;
  tokens: string;
  share: number;
}

export interface TaskRow {
  taskId: string;
  title: string;
  tokens: string;
  cacheHit: string;
  cost: string;
}

export const USAGE_SECTION = 'Token usage';

export const TOP_TASKS = 8;

export const TOKEN_KINDS: readonly { kind: TokenKind; label: string }[] = [
  { kind: 'cacheReadTokens', label: 'Cache read' },
  { kind: 'cacheWriteTokens', label: 'Cache write' },
  { kind: 'inputTokens', label: 'Input' },
  { kind: 'outputTokens', label: 'Output' },
];

const WORK_LABEL: Record<StatsWork, string> = {
  plan: 'Planning',
  build: 'Building',
  fix: 'Fixing',
  operate: 'Operations',
  watch: 'Watchdogs',
  agent: RUN_ROLE.agent.name,
  planner: RUN_ROLE.planner.name,
  builder: RUN_ROLE.builder.name,
  reviewer: 'Review',
  answerer: 'Answers',
  investigator: 'Investigations',
  researcher: 'Research',
};

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

export function formatPercent(rate: number | null) {
  return rate === null ? 'None' : `${Math.round(rate * 100)}%`;
}

export function listUsageTiles(stats: Stats): ShippingTile[] {
  const { usage, pullRequests } = stats.total;
  return [
    {
      key: 'tokens',
      label: 'Tokens',
      value: formatTokenCount(usage.tokens),
      detail: `${formatTokenCount(usage.inputTokens)} in, ${formatTokenCount(usage.outputTokens)} out`,
    },
    {
      key: 'cost',
      label: 'Known cost',
      value: describeUsd(usage.knownUsd),
      detail: formatCount(usage.runs, 'agent run', 'agent runs'),
    },
    {
      key: 'cache',
      label: 'Cache hit rate',
      value: formatPercent(stats.cacheHitRate),
      detail: `${formatTokenCount(usage.cacheReadTokens)} read from cache`,
    },
    {
      key: 'per-pull-request',
      label: 'Tokens per pull request',
      value: pullRequests === 0 ? 'None' : formatTokenCount(Math.round(usage.tokens / pullRequests)),
      detail: pullRequests === 0 ? 'No pull requests merged' : `Over ${formatNumber(pullRequests)} merged`,
    },
  ];
}

export function listTokenPoints(days: StatsDay[]): TokenPoint[] {
  if (days.length <= WEEKLY_AFTER_DAYS) {
    return days.map((day) => ({ label: formatShortDay(day.day), from: day.day, usage: day.usage }));
  }
  const points: TokenPoint[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const week = days.slice(Math.max(0, end - 7), end);
    const first = week[0] as StatsDay;
    points.unshift({
      label: `Week of ${formatShortDay(first.day)}`,
      from: first.day,
      usage: sumTokenLines(week.map((day) => day.usage)),
    });
  }
  return points;
}

export function listTokenBars(points: TokenPoint[]): { bars: TokenBar[]; max: number } {
  const max = resolveChartMax(points.map((point) => point.usage.tokens));
  const bars = points.map((point) => ({
    label: point.label,
    from: point.from,
    tokens: point.usage.tokens,
    segments: TOKEN_KINDS.map(({ kind }) => ({ kind, tokens: point.usage[kind] })),
  }));
  return { bars, max };
}

function listRows<Key extends string>(
  lines: StatsBreakdown<Key>[],
  total: TokenLine,
  label: (key: Key) => string
): BreakdownRow[] {
  return lines.map((line) => ({
    key: line.key,
    label: label(line.key),
    tokens: formatTokenCount(line.usage.tokens),
    share: total.tokens === 0 ? 0 : line.usage.tokens / total.tokens,
  }));
}

export function listBreakdowns(stats: Stats) {
  const total = stats.total.usage;
  return [
    {
      key: 'work',
      title: 'By kind of work',
      rows: listRows(stats.byWork, total, (key) => WORK_LABEL[key]),
    },
    {
      key: 'role',
      title: 'By role',
      rows: listRows(stats.byRole, total, (key) => RUN_ROLE[key].name),
    },
    {
      key: 'model',
      title: 'By model',
      rows: listRows(stats.byModel, total, (key) =>
        key === UNKNOWN_MODEL ? 'Unknown model' : resolveModelLabel(key)
      ),
    },
  ];
}

export function listTaskRows(tasks: TaskTokens[]): TaskRow[] {
  return tasks.slice(0, TOP_TASKS).map((task) => ({
    taskId: task.taskId,
    title: task.title,
    tokens: formatTokenCount(task.usage.tokens),
    cacheHit: formatPercent(task.cacheHitRate),
    cost: describeUsd(task.usage.knownUsd),
  }));
}
