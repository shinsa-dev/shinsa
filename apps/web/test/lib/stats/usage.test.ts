import { describe, expect, it } from 'bun:test';
import {
  resolveStats,
  type Stats,
  type StatsSaving,
  type TaskTokens,
  type TokenLine,
  UNKNOWN_MODEL,
} from '@shinsa/core';
import { listCalendarDays, resolveDayKey } from '@/lib/stats/days.ts';
import {
  describeTokenBar,
  formatPercent,
  listBreakdowns,
  listSavingRows,
  listTaskRows,
  listTokenBars,
  listTokenPoints,
  listUsageTiles,
  TOP_TASKS,
} from '@/lib/stats/usage.ts';

function line(overrides: Partial<TokenLine> = {}): TokenLine {
  return {
    runs: 1,
    inputTokens: 1_000,
    outputTokens: 2_000,
    cacheReadTokens: 6_000,
    cacheWriteTokens: 1_000,
    tokens: 10_000,
    knownUsd: 0.5,
    ...overrides,
  };
}

function statsOf(
  days: string[],
  usage: Record<string, TokenLine> = {},
  overrides: Partial<Stats> = {}
): Stats {
  const stats = resolveStats({ tasks: {}, runs: {} }, { days, dayOf: resolveDayKey });
  const withUsage = stats.days.map((day) => ({ ...day, usage: usage[day.day] ?? day.usage }));
  return { ...stats, days: withUsage, ...overrides };
}

function taskTokens(taskId: string, overrides: Partial<TaskTokens> = {}): TaskTokens {
  return {
    taskId,
    title: `Task ${taskId}`,
    handle: null,
    usage: line(),
    cacheHitRate: 0.75,
    freshSessions: 0,
    compactions: 0,
    ...overrides,
  };
}

describe('usage', () => {
  it('tiles the tokens, the known cost, the cache hit rate and the tokens per merged pull request', () => {
    const range = statsOf([]);
    const stats = {
      ...range,
      cacheHitRate: 0.6,
      total: { ...range.total, pullRequests: 4, usage: line({ tokens: 2_400_000, knownUsd: 12.5, runs: 9 }) },
    };
    expect(listUsageTiles(stats)).toEqual([
      { key: 'tokens', label: 'Tokens', value: '2.4M', detail: '1k in, 2k out' },
      { key: 'cost', label: 'Known cost', value: '$12.50', detail: '9 agent runs' },
      { key: 'cache', label: 'Cache hit rate', value: '60%', detail: '6k read from cache' },
      { key: 'per-pull-request', label: 'Tokens per pull request', value: '600k', detail: 'Over 4 merged' },
    ]);
    expect(listUsageTiles(range).at(-1)).toMatchObject({ value: 'None', detail: 'No pull requests merged' });
    expect(formatPercent(null)).toBe('None');
  });

  it('charts a month day by day and a longer range week by week, each bar split by kind of token', () => {
    const now = new Date(2026, 10, 30).getTime();
    const month = listTokenPoints(statsOf(listCalendarDays(now, 30), { '2026-11-30': line() }).days);
    expect(month).toHaveLength(30);
    const quarter = listTokenPoints(
      statsOf(listCalendarDays(now, 90), { '2026-11-30': line(), '2026-11-25': line() }).days
    );
    expect(quarter).toHaveLength(13);
    expect(quarter.at(-1)?.usage.tokens).toBe(20_000);
    expect(quarter.at(-1)?.usage.runs).toBe(2);
    const { bars, max } = listTokenBars(quarter);
    expect(max).toBe(20_000);
    expect(bars.at(-1)?.segments).toEqual([
      { kind: 'cacheReadTokens', share: 0.6 },
      { kind: 'cacheWriteTokens', share: 0.1 },
      { kind: 'inputTokens', share: 0.1 },
      { kind: 'outputTokens', share: 0.2 },
    ]);
    expect(describeTokenBar(bars.at(-1) as (typeof bars)[number])).toMatch(/^Week of .+: 20k tokens$/);
    expect(listTokenBars(listTokenPoints(statsOf(['2026-11-30']).days)).bars[0]?.segments[0]?.share).toBe(0);
  });

  it('labels the breakdowns by kind of work, role and model, with each one’s share', () => {
    const stats = statsOf(
      [],
      {},
      {
        byWork: [
          { key: 'build', usage: line({ tokens: 750 }) },
          { key: 'reviewer', usage: line({ tokens: 250 }) },
        ],
        byRole: [{ key: 'agent', usage: line({ tokens: 1_000 }) }],
        byModel: [
          { key: 'claude-opus-5-5', usage: line({ tokens: 900 }) },
          { key: UNKNOWN_MODEL, usage: line({ tokens: 100 }) },
        ],
      }
    );
    const total = { ...stats.total, usage: line({ tokens: 1_000 }) };
    const [work, role, model] = listBreakdowns({ ...stats, total });
    expect(work?.rows.map((row) => [row.label, row.share, row.tokens, row.cost])).toEqual([
      ['Building', 0.75, '750', '$0.50'],
      ['Review', 0.25, '250', '$0.50'],
    ]);
    expect(role?.rows.map((row) => row.label)).toEqual(['Agent']);
    expect(model?.rows.map((row) => row.label)).toEqual(['Opus 5.5', 'Unknown model']);
    const empty = listBreakdowns({ ...stats, total: { ...stats.total, usage: line({ tokens: 0 }) } });
    expect(empty[0]?.rows[0]?.share).toBe(0);
  });

  it('lists the tasks that used the most tokens, at most eight', () => {
    const tasks = Array.from({ length: 10 }, (_, index) => taskTokens(`t${index}`));
    const rows = listTaskRows(tasks);
    expect(rows).toHaveLength(TOP_TASKS);
    expect(rows[0]).toEqual({
      taskId: 't0',
      title: 'Task t0',
      handle: null,
      tokens: '10k',
      cacheHit: '75%',
      cost: '$0.50',
    });
  });

  it('says what each saving is about', () => {
    const wasteful = taskTokens('w', {
      usage: line({ inputTokens: 100_000, cacheReadTokens: 50_000, cacheWriteTokens: 100_000 }),
    });
    const savings: StatsSaving[] = [
      { kind: 'cache_misses', task: wasteful },
      { kind: 'cache_writes', task: wasteful },
      { kind: 'fresh_sessions', task: taskTokens('f', { freshSessions: 2 }) },
      { kind: 'compactions', task: taskTokens('c', { compactions: 3 }) },
    ];
    expect(listSavingRows(savings).map((row) => [row.key, row.headline, row.detail])).toEqual([
      ['w-cache_misses', 'Only 20% of the prompt came from the cache', '200k prompt tokens were sent fresh.'],
      [
        'w-cache_writes',
        '40% of the prompt was written to the cache',
        'The start of the prompt kept changing, so the cache was rebuilt instead of read.',
      ],
      [
        'f-fresh_sessions',
        '2 fresh sessions',
        'The agent started over and read its context again instead of resuming.',
      ],
      [
        'c-compactions',
        'Compacted 3 times',
        'The context filled up; a smaller brief or fewer large tool outputs would keep it lighter.',
      ],
    ]);
  });
});
