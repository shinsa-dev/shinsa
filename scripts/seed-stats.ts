import type { PullRequestChanges, Repo, RunUsage } from '../packages/core/src/index.ts';
import { HOUR, NOW, type SeedRun, type SeedTask, type TimedSeedEvent } from './seed-kit.ts';

interface HistoryEntry {
  title: string;
  branch: string;
  daysAgo: number;
  changes: PullRequestChanges;
  tokens: number;
  cacheHit?: number;
  freshSessions?: number;
}

const HISTORY: HistoryEntry[] = [
  {
    title: 'Retry webhook deliveries with backoff',
    branch: 'feat/webhook-backoff',
    daysAgo: 1,
    changes: { additions: 214, deletions: 38, changedFiles: 7 },
    tokens: 1_400_000,
  },
  {
    title: 'Show trial end dates on the paywall',
    branch: 'feat/trial-end',
    daysAgo: 2,
    changes: { additions: 96, deletions: 12, changedFiles: 4 },
    tokens: 620_000,
  },
  {
    title: 'Cache experiment assignments per user',
    branch: 'perf/assignment-cache',
    daysAgo: 2,
    changes: { additions: 188, deletions: 64, changedFiles: 6 },
    tokens: 3_900_000,
    cacheHit: 0.32,
  },
  {
    title: 'Fix currency rounding in yen prices',
    branch: 'fix/yen-rounding',
    daysAgo: 3,
    changes: { additions: 22, deletions: 9, changedFiles: 2 },
    tokens: 280_000,
  },
  {
    title: 'Add a dark variant to the paywall preview',
    branch: 'feat/preview-dark',
    daysAgo: 5,
    changes: { additions: 340, deletions: 120, changedFiles: 11 },
    tokens: 2_100_000,
    freshSessions: 2,
  },
  {
    title: 'Paginate the transactions table',
    branch: 'feat/transactions-pages',
    daysAgo: 6,
    changes: { additions: 156, deletions: 41, changedFiles: 5 },
    tokens: 900_000,
  },
  {
    title: 'Log slow ClickHouse queries',
    branch: 'chore/slow-queries',
    daysAgo: 8,
    changes: { additions: 48, deletions: 3, changedFiles: 2 },
    tokens: 340_000,
  },
  {
    title: 'Move feature flags into the settings store',
    branch: 'refactor/flags-store',
    daysAgo: 9,
    changes: { additions: 410, deletions: 380, changedFiles: 23 },
    tokens: 5_200_000,
    cacheHit: 0.41,
  },
  {
    title: 'Validate product ids on import',
    branch: 'fix/product-ids',
    daysAgo: 9,
    changes: { additions: 61, deletions: 14, changedFiles: 3 },
    tokens: 410_000,
  },
  {
    title: 'Send a receipt email after a refund',
    branch: 'feat/refund-receipt',
    daysAgo: 12,
    changes: { additions: 132, deletions: 8, changedFiles: 5 },
    tokens: 760_000,
  },
  {
    title: 'Speed up the campaign list query',
    branch: 'perf/campaign-list',
    daysAgo: 15,
    changes: { additions: 74, deletions: 51, changedFiles: 3 },
    tokens: 1_100_000,
  },
  {
    title: 'Group placements by screen in the editor',
    branch: 'feat/placement-groups',
    daysAgo: 16,
    changes: { additions: 268, deletions: 90, changedFiles: 9 },
    tokens: 1_800_000,
  },
  {
    title: 'Keep the selected app across reloads',
    branch: 'fix/selected-app',
    daysAgo: 19,
    changes: { additions: 35, deletions: 17, changedFiles: 2 },
    tokens: 230_000,
  },
  {
    title: 'Export audience members as CSV',
    branch: 'feat/audience-csv',
    daysAgo: 23,
    changes: { additions: 190, deletions: 6, changedFiles: 6 },
    tokens: 1_300_000,
  },
  {
    title: 'Fix the date picker in Safari',
    branch: 'fix/safari-date-picker',
    daysAgo: 23,
    changes: { additions: 18, deletions: 22, changedFiles: 1 },
    tokens: 190_000,
  },
  {
    title: 'Add audit entries for API key changes',
    branch: 'feat/key-audit',
    daysAgo: 26,
    changes: { additions: 144, deletions: 20, changedFiles: 6 },
    tokens: 980_000,
  },
  {
    title: 'Rename revenue events in the SDK bridge',
    branch: 'refactor/revenue-events',
    daysAgo: 33,
    changes: { additions: 220, deletions: 214, changedFiles: 14 },
    tokens: 2_400_000,
    freshSessions: 1,
  },
  {
    title: 'Limit preview renders per minute',
    branch: 'feat/preview-limit',
    daysAgo: 37,
    changes: { additions: 83, deletions: 10, changedFiles: 3 },
    tokens: 540_000,
  },
  {
    title: 'Show localisation coverage per paywall',
    branch: 'feat/l10n-coverage',
    daysAgo: 44,
    changes: { additions: 175, deletions: 33, changedFiles: 7 },
    tokens: 1_250_000,
  },
  {
    title: 'Drop the legacy template renderer',
    branch: 'chore/legacy-renderer',
    daysAgo: 51,
    changes: { additions: 12, deletions: 1_840, changedFiles: 31 },
    tokens: 1_600_000,
  },
  {
    title: 'Fix stale totals on the dashboard',
    branch: 'fix/stale-totals',
    daysAgo: 58,
    changes: { additions: 41, deletions: 19, changedFiles: 3 },
    tokens: 470_000,
  },
  {
    title: 'Add SSO login for workspaces',
    branch: 'feat/workspace-sso',
    daysAgo: 66,
    changes: { additions: 620, deletions: 88, changedFiles: 19 },
    tokens: 4_300_000,
  },
];

const RUNS: SeedRun[] = [
  { role: 'agent', purpose: 'plan', minutes: 4, summary: 'Planned the change.' },
  { role: 'agent', purpose: 'build', minutes: 12, summary: 'Built the change.' },
  { role: 'reviewer', minutes: 3, summary: 'Reviewed the change.' },
];

const RUN_SHARES = [0.2, 0.65, 0.15];

const FIRST_PULL_REQUEST = 4400;

function resolveUsage(tokens: number, cacheHit: number): RunUsage {
  const output = Math.round(tokens * 0.04);
  const prompt = tokens - output;
  const cacheWrite = Math.round(prompt * 0.06);
  const cacheRead = Math.round(prompt * cacheHit);
  return {
    inputTokens: prompt - cacheRead - cacheWrite,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: Number((tokens / 400_000).toFixed(2)),
  };
}

function listMeterEvents(taskId: string, entry: HistoryEntry, at: number): TimedSeedEvent[] {
  const fresh = Array.from({ length: entry.freshSessions ?? 0 }, (_, index) => ({
    at,
    event: {
      type: 'run.attempted' as const,
      runId: `${taskId}-run-1`,
      attemptId: `${taskId}-fresh-${index}`,
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
    },
  }));
  const meters = RUN_SHARES.map((share, index) => ({
    at: at + index,
    event: {
      type: 'run.metered' as const,
      runId: `${taskId}-run-${index}`,
      usage: resolveUsage(Math.round(entry.tokens * share), entry.cacheHit ?? 0.82),
    },
  }));
  return [...fresh, ...meters];
}

export function listHistoryTasks(repo: Repo): SeedTask[] {
  return HISTORY.map((entry, index) => {
    const id = `task-history-${index + 1}`;
    const ageHours = entry.daysAgo * 24 + 3;
    return {
      id,
      request: entry.title,
      title: entry.title,
      repo,
      size: 'small',
      stage: 'merged',
      reason: 'merged',
      branch: entry.branch,
      ageHours,
      runs: RUNS,
      pullRequest: { number: FIRST_PULL_REQUEST - index, checks: 'passing', changes: entry.changes },
      merged: true,
      summary: entry.title,
      timed: listMeterEvents(id, entry, NOW - ageHours * HOUR + HOUR),
    };
  });
}
