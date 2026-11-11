import { join } from 'node:path';
import { Option } from 'effect';
import {
  type AccountUsage,
  type ChatNotice,
  type Repo,
  resolveNextRun,
  type Schedule,
  type ScheduleRun,
  SCHEDULE_FILTER_SKIPPED,
  type UsageWindow,
} from '../../../packages/core/src/index.ts';
import { HOUR, MINUTE } from '../../kit/time.ts';
import { NOW, type SeedTask } from '../kit.ts';
import { insertNotices } from '../notices.ts';

const OPS = { id: 'acct-ops', email: 'ops@superwall.dev' };

const PERSONAL = { id: 'acct-personal', email: 'christo@hey.com' };

const SPARE = { id: 'acct-spare', email: 'spare@superwall.dev' };

function window(id: string, kind: UsageWindow['kind'], label: string, usedPercent: number, resetsIn: number) {
  return { id, kind, label, model: kind === 'model' ? 'fable' : null, usedPercent, resetsAt: NOW + resetsIn };
}

function createAccountUsage(windows: UsageWindow[]): AccountUsage {
  return { status: 'ok', windows, detail: null, checkedAt: NOW - 2 * MINUTE, source: 'read' };
}

export function listAccountFiles(data: string): Record<string, string> {
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
  const limits = {
    version: 1,
    accounts: {
      [PERSONAL.id]: {
        ...createAccountUsage([
          window('session', 'session', '5-hour limit', 64, 2 * HOUR),
          window('weekly_all', 'weekly', 'Weekly · All models', 41, 3 * 24 * HOUR),
          window('weekly_fable', 'model', 'Weekly · Fable', 72, 3 * 24 * HOUR),
        ]),
        extraUsage: { enabled: true, noLimit: false, credit: { minor: 1240, exponent: 2, currency: 'USD' } },
        resetGrants: [
          {
            id: 'seed-launch-grant',
            label: null,
            left: 1,
            total: 2,
            clears: ['five_hour', 'seven_day'],
            usableNow: true,
            endsAt: NOW + 14 * 24 * HOUR,
            givesBackWeekly: false,
            weeklyShare: null,
          },
          {
            id: 'seed-fable-grant',
            label: null,
            left: 1,
            total: 1,
            clears: ['seven_day_overage_included'],
            usableNow: true,
            endsAt: NOW + 2 * 24 * HOUR + 3 * HOUR,
            givesBackWeekly: true,
            weeklyShare: 27,
          },
        ],
      },
      [OPS.id]: {
        ...createAccountUsage([
          window('session', 'session', '5-hour limit', 100, 40 * MINUTE),
          window('weekly_all', 'weekly', 'Weekly · All models', 93, 2 * 24 * HOUR),
        ]),
        extraUsage: { enabled: false, noLimit: false, credit: null },
      },
      [SPARE.id]: {
        ...createAccountUsage([
          window('session', 'session', '5-hour limit', 3, 4 * HOUR),
          window('weekly_all', 'weekly', 'Weekly · All models', 12, 6 * 24 * HOUR),
        ]),
        detail: 'Rate limited by Claude.',
        checkedAt: NOW - 3 * HOUR,
        retryAt: NOW + 12 * MINUTE,
      },
    },
  };
  return {
    'accounts.json': `${JSON.stringify(registry, null, 2)}\n`,
    'usage-limits.json': `${JSON.stringify(limits, null, 2)}\n`,
  };
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
    source: null,
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
    lastReadAt: null,
    stopped: null,
    replayKeys: {},
    ...fields,
    nextRunAt:
      fields.enabled === false
        ? null
        : Option.getOrNull(resolveNextRun(fields.trigger, NOW, 'Europe/Berlin')),
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
    schedule({
      id: 'schedule-alerts',
      name: 'Triage production alerts',
      text: 'An alert was posted in #alerts. Find what broke, and fix it when the cause is in this repository.',
      trigger: {
        kind: 'slack',
        teamId: 'T04SUPERWALL',
        teamName: 'Superwall',
        channelId: 'C07ALERTS',
        channelName: 'alerts',
        threadUpdates: true,
      },
      runCount: 3,
      runs: [
        scheduleRun('sent', 30 * HOUR),
        scheduleRun('skipped', 9 * HOUR, SCHEDULE_FILTER_SKIPPED),
        scheduleRun('sent', 2 * HOUR),
      ],
      createdBy: { kind: 'you' },
    }),
    schedule({
      id: 'schedule-feedback',
      name: 'Front-end feedback',
      text: 'Feedback was posted in #feedback. File a task only when it is about the web app’s interface; leave billing and API feedback alone.',
      trigger: {
        kind: 'slack',
        teamId: 'T04SUPERWALL',
        teamName: 'Superwall',
        channelId: 'C07FEEDBACK',
        channelName: 'feedback',
        threadUpdates: false,
      },
      runCount: 1,
      runs: [
        scheduleRun('sent', 20 * HOUR),
        scheduleRun('skipped', 6 * HOUR, SCHEDULE_FILTER_SKIPPED),
        scheduleRun('skipped', 90 * MINUTE, SCHEDULE_FILTER_SKIPPED),
      ],
      createdBy: { kind: 'you' },
    }),
    schedule({
      id: 'schedule-support',
      name: 'Support reports',
      text: 'Bug reports and feature requests about the docs and the paywalls.',
      trigger: { kind: 'interval', everyMinutes: 60 },
      target: { kind: 'task', taskId: 'task-support-intake' },
      source: { projectId: 'project-superwall', server: 'composio-slack' },
      runCount: 48,
      runs: [
        scheduleRun('sent', 7 * HOUR),
        scheduleRun('sent', 6 * HOUR),
        scheduleRun('sent', 5 * HOUR),
        scheduleRun('sent', 4 * HOUR),
        scheduleRun('sent', 3 * HOUR),
        scheduleRun('skipped', 2 * HOUR, 'The task was at work, so this read was skipped.'),
        scheduleRun('sent', 55 * MINUTE),
      ],
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

export const ACCOUNT_MOVE_TRANSCRIPT = 'task-account-move-run-1.jsonl';

export function insertAccountNotices(transcript: string) {
  return insertNotices(transcript, MOVED_NOTICES, NOW);
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
      id: 'task-pace-hold',
      request: 'Cache the parsed transcripts so reopening a long session is instant',
      title: 'Cache parsed transcripts in Kanna',
      repo: kanna,
      size: 'small',
      stage: 'building',
      reason: 'held at the project’s usage limit',
      branch: 'perf/cache-transcripts',
      ageHours: 2,
      runs: [
        { role: 'agent', purpose: 'build', minutes: 18, summary: 'Finished the first phase.' },
        { role: 'agent', purpose: 'build', minutes: 0, summary: 'Held at a usage limit before it started.' },
      ],
      extra: [
        {
          type: 'run.ended',
          runId: 'task-pace-hold-run-0',
          outcome: 'completed',
          summary: 'Finished the first phase.',
        },
        {
          type: 'run.ended',
          runId: 'task-pace-hold-run-1',
          outcome: 'cancelled',
          summary: 'Held at a usage limit before it started.',
        },
        {
          type: 'usage_wait.armed',
          taskId: 'task-pace-hold',
          wait: {
            id: 'wait-pace',
            runId: 'task-pace-hold-run-1',
            role: 'agent',
            phaseIndex: 1,
            account: null,
            resetAt: NOW + 3 * HOUR + 20 * MINUTE,
            armedAt: NOW - 25 * MINUTE,
            autoResume: true,
            status: 'armed',
            cause: 'pace',
            pace: {
              scope: 'project',
              limit: 20,
              percent: 21.4,
              projectId: 'project-personal',
              stageReason: 'building phase 2',
            },
          },
        },
      ],
    },
    {
      id: 'task-admission',
      request: 'Move the paywall editor’s preview into a worker so typing never stalls',
      title: 'Render the paywall preview in a worker',
      repo: paywall,
      size: 'large',
      stage: 'building',
      reason: 'waiting its turn to build within today’s usage',
      branch: 'perf/preview-worker',
      ageHours: 1,
      runs: [
        { role: 'agent', purpose: 'build', minutes: 0, summary: 'Held at a usage limit before it started.' },
      ],
      extra: [
        {
          type: 'run.ended',
          runId: 'task-admission-run-0',
          outcome: 'cancelled',
          summary: 'Held at a usage limit before it started.',
        },
        {
          type: 'usage_wait.armed',
          taskId: 'task-admission',
          wait: {
            id: 'wait-admission',
            runId: 'task-admission-run-0',
            role: 'agent',
            phaseIndex: 0,
            account: null,
            resetAt: NOW + 9 * HOUR,
            armedAt: NOW - 40 * MINUTE,
            autoResume: true,
            status: 'armed',
            cause: 'pace',
            pace: {
              scope: 'admission',
              limit: 126,
              percent: 121.5,
              projectId: null,
              stageReason: 'building phase 1',
              need: 14.2,
            },
          },
        },
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
    {
      id: 'task-browser-sign-in',
      request: 'Show the dispute count on the Stripe dashboard card',
      title: 'Show dispute count on the Stripe card',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'waiting for your answer',
      branch: 'feat/stripe-dispute-count',
      ageHours: 0.3,
      runs: [{ role: 'agent', purpose: 'build', minutes: 6, summary: 'Asked to sign the browser in.' }],
      gate: {
        type: 'browser_sign_in',
        title: 'Sign in to dashboard.stripe.com',
        body: 'To screenshot the new dispute count on the Stripe card, the dashboard has to be signed in.',
        details: {
          browserSignIn: { url: 'https://dashboard.stripe.com/login', site: 'dashboard.stripe.com' },
        },
      },
    },
  ];
}
