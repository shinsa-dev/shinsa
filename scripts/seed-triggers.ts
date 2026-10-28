import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AccountUsage,
  type ChatNotice,
  type Repo,
  resolveNextRun,
  type Schedule,
  type ScheduleRun,
  type UsageWindow,
} from '../packages/core/src/index.ts';
import { HOUR, MINUTE, NOW, type SeedTask } from './seed-kit.ts';

const OPS = { id: 'acct-ops', email: 'ops@superwall.dev' };

const PERSONAL = { id: 'acct-personal', email: 'christo@hey.com' };

const SPARE = { id: 'acct-spare', email: 'spare@superwall.dev' };

function window(id: string, kind: UsageWindow['kind'], label: string, usedPercent: number, resetsIn: number) {
  return { id, kind, label, model: kind === 'model' ? 'fable' : null, usedPercent, resetsAt: NOW + resetsIn };
}

function createAccountUsage(windows: UsageWindow[]): AccountUsage {
  return { status: 'ok', windows, detail: null, checkedAt: NOW - 2 * MINUTE, source: 'read' };
}

export function writeAccountFiles(data: string) {
  const account = (details: typeof OPS, extra: Record<string, unknown>) => ({
    id: details.id,
    configDir: join(data, 'accounts', details.id),
    email: details.email,
    organization: 'Superwall',
    plan: 'Max',
    origin: 'login',
    addedAt: NOW - 30 * 24 * HOUR,
    paused: false,
    switchAt: null,
    ...extra,
  });
  const registry = {
    version: 1,
    defaultAccountId: PERSONAL.id,
    accounts: [
      account(PERSONAL, { configDir: null, origin: 'claude', organization: null }),
      account(OPS, { switchAt: 80 }),
      account(SPARE, { paused: true }),
    ],
  };
  writeFileSync(join(data, 'accounts.json'), `${JSON.stringify(registry, null, 2)}\n`);
  const limits = {
    version: 1,
    accounts: {
      [PERSONAL.id]: createAccountUsage([
        window('session', 'session', '5-hour limit', 64, 2 * HOUR),
        window('weekly_all', 'weekly', 'Weekly · All models', 41, 3 * 24 * HOUR),
        window('weekly_fable', 'model', 'Weekly · Fable', 72, 3 * 24 * HOUR),
      ]),
      [OPS.id]: createAccountUsage([
        window('session', 'session', '5-hour limit', 100, 40 * MINUTE),
        window('weekly_all', 'weekly', 'Weekly · All models', 93, 2 * 24 * HOUR),
      ]),
      [SPARE.id]: createAccountUsage([
        window('session', 'session', '5-hour limit', 3, 4 * HOUR),
        window('weekly_all', 'weekly', 'Weekly · All models', 12, 6 * 24 * HOUR),
      ]),
    },
  };
  writeFileSync(join(data, 'usage-limits.json'), `${JSON.stringify(limits, null, 2)}\n`);
}

function scheduleRun(
  outcome: ScheduleRun['outcome'],
  ago: number,
  detail: string | null = null
): ScheduleRun {
  return { at: NOW - ago, outcome, taskId: null, deliveryId: null, detail };
}

function schedule(fields: Partial<Schedule> & Pick<Schedule, 'id' | 'name' | 'text' | 'trigger'>): Schedule {
  return {
    target: { kind: 'new_task', repoId: 'repo-paywall', priority: 'normal', mode: 'build' },
    timeZone: 'Europe/Berlin',
    enabled: true,
    runCount: 0,
    maxRuns: null,
    runs: [],
    createdAt: NOW - 5 * 24 * HOUR,
    updatedAt: NOW - 5 * 24 * HOUR,
    createdBy: { kind: 'agent', taskId: 'task-usage-wait', runId: 'task-usage-wait-run-0' },
    lastTaskId: null,
    lastRunId: null,
    stopped: null,
    replayKeys: {},
    ...fields,
    nextRunAt: fields.enabled === false ? null : resolveNextRun(fields.trigger, NOW, 'Europe/Berlin'),
  };
}

function listSchedules(): Schedule[] {
  return [
    schedule({
      id: 'schedule-deploys',
      name: 'Summarise failed deploys',
      text: 'Read yesterday’s failed staging deploys and open a task for anything that failed twice.',
      trigger: { kind: 'daily', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
      runCount: 4,
      runs: [
        scheduleRun('sent', 21 * HOUR),
        scheduleRun('skipped', 45 * HOUR, 'The last task is still open.'),
      ],
    }),
    schedule({
      id: 'schedule-flaky',
      name: 'Check the flaky export test',
      text: 'Run the export suite and say whether the flake is back.',
      trigger: { kind: 'interval', everyMinutes: 30 },
      target: { kind: 'task', taskId: 'task-sign-in' },
      enabled: false,
      runCount: 12,
      runs: [scheduleRun('failed', 3 * HOUR, 'The task it messages is finished.')],
    }),
    schedule({
      id: 'schedule-stripe',
      name: 'Stripe disputes',
      text: 'A dispute arrived: {{body.data.object.reason}}. Check the paywall that sold it.',
      trigger: {
        kind: 'webhook',
        signature: { header: 'Stripe-Signature', encoding: 'hex', prefix: 'v1=' },
        replayKey: '{{body.id}}',
      },
      runCount: 2,
      runs: [scheduleRun('sent', 26 * HOUR)],
      createdBy: { kind: 'you' },
    }),
  ];
}

function attempted(runId: string, attempt: number, account: typeof OPS) {
  return {
    type: 'run.attempted' as const,
    runId,
    attemptId: `${runId}:${attempt}`,
    provider: 'claude',
    model: 'opus',
    resumed: attempt > 1,
    handoff: null,
    account,
  };
}

const MOVED_NOTICES: ChatNotice[] = [
  { kind: 'account_switched', email: OPS.email, previous: PERSONAL.email, reason: 'usage_limit' },
  {
    kind: 'handoff',
    reason: 'session_restore',
    fromProvider: 'Claude',
    toProvider: 'Claude',
    totalEntries: 46,
    includedEntries: 46,
  },
  { kind: 'compaction', trigger: 'auto', preTokens: 168_000, summary: null },
];

export function writeAccountTranscripts(dir: string) {
  const path = join(dir, 'task-account-move-run-1.jsonl');
  const entries = readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { id: string; at: number });
  const brief = entries[1] ?? entries[0];
  const at = brief?.at ?? NOW;
  const notices = MOVED_NOTICES.map((notice, index) => ({
    ...(brief ?? {}),
    id: `task-account-move-run-1-notice-${index}`,
    at: at + index + 1,
    type: 'notice',
    notice,
  }));
  const context = {
    ...(brief ?? {}),
    id: 'task-account-move-run-1-context',
    at: NOW - MINUTE,
    type: 'notice',
    notice: { kind: 'context', usedTokens: 132_000, maxTokens: 200_000, totalProcessedTokens: 910_000 },
  };
  const lines = [...entries.slice(0, 2), ...notices, ...entries.slice(2), context];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

export function listTriggerTasks({ paywall, kanna }: { paywall: Repo; kanna: Repo }): SeedTask[] {
  return [
    {
      id: 'task-account-move',
      request: 'Stream large paywall exports to the browser instead of building them in memory',
      title: 'Stream large paywall exports',
      repo: paywall,
      size: 'large',
      stage: 'building',
      reason: 'building phase 2 of 3',
      branch: 'feat/stream-exports',
      ageHours: 3,
      runs: [
        { role: 'agent', purpose: 'build', minutes: 25, summary: 'Streamed the CSV writer.' },
        { role: 'agent', purpose: 'build', minutes: 18, summary: 'Wiring the download route.' },
      ],
      extra: [
        attempted('task-account-move-run-0', 1, PERSONAL),
        attempted('task-account-move-run-1', 1, PERSONAL),
        attempted('task-account-move-run-1', 2, OPS),
      ],
    },
    {
      id: 'task-sign-in',
      request: 'Retry the paywall preview build when the CDN times out',
      title: 'Retry preview builds on CDN timeouts',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'paused',
      branch: 'fix/preview-cdn-retry',
      ageHours: 2,
      runs: [{ role: 'agent', purpose: 'build', minutes: 6, summary: 'Signed out.', failed: true }],
      extra: [{ type: 'task.account_bound', taskId: 'task-sign-in', account: OPS }],
      gate: {
        type: 'sign_in',
        title: `Paused: ${OPS.email} needs signing in`,
        body: 'Claude signed this account out, so the agent stopped. Signing in starts the step again.',
        details: { provider: 'claude', account: OPS },
      },
    },
    {
      id: 'task-codex-sign-in',
      request: 'Log the export id with every ClickHouse timeout',
      title: 'Log the export id on ClickHouse timeouts',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'paused',
      branch: 'fix/log-export-timeouts',
      ageHours: 1.2,
      provider: 'codex',
      runs: [{ role: 'agent', purpose: 'build', minutes: 3, summary: 'Signed out.', failed: true }],
      gate: {
        type: 'sign_in',
        title: `Paused: ${PERSONAL.email} needs signing in`,
        body: 'Codex signed this account out, so the agent stopped. Signing in starts the step again.',
        details: { provider: 'codex', account: null },
      },
    },
    {
      id: 'task-usage-wait',
      request: 'Batch the analytics writes so the ingest worker stops timing out',
      title: 'Batch analytics writes in the ingest worker',
      repo: kanna,
      size: 'small',
      stage: 'building',
      reason: 'waiting for the usage limit to reset',
      branch: 'fix/batch-analytics-writes',
      ageHours: 1,
      runs: [{ role: 'agent', purpose: 'build', minutes: 12, summary: 'Hit the usage limit.', failed: true }],
      extra: [
        {
          type: 'usage_wait.armed',
          taskId: 'task-usage-wait',
          wait: {
            id: 'wait-usage',
            runId: 'task-usage-wait-run-0',
            role: 'agent',
            phaseIndex: null,
            account: PERSONAL,
            resetAt: NOW + 38 * MINUTE,
            armedAt: NOW - 8 * MINUTE,
            autoResume: true,
            status: 'armed',
          },
        },
        ...listSchedules().map((written) => ({ type: 'schedule.written' as const, schedule: written })),
      ],
    },
    {
      id: 'task-secret',
      request: 'Verify Stripe webhook signatures before handling disputes',
      title: 'Verify Stripe webhook signatures',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'waiting for your answer',
      branch: 'fix/stripe-webhook-signature',
      ageHours: 0.5,
      runs: [{ role: 'agent', purpose: 'build', minutes: 4, summary: 'Asked for the signing secret.' }],
      gate: {
        type: 'secret',
        title:
          'The dispute handler checks Stripe’s signature on every webhook; it needs the endpoint’s signing secret.',
        body: '',
        details: { secret: { label: 'Stripe webhook signing secret' } },
      },
    },
  ];
}
