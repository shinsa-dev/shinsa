import type { Repo, ReviewFinding, RunUsage, PlanDocument } from '../packages/core/src/index.ts';
import { MINUTE, NOW, type SeedTask } from './seed-kit.ts';

function createRunUsage(costUsd: number | null, tokens: number): RunUsage {
  return {
    inputTokens: Math.round(tokens * 0.2),
    outputTokens: Math.round(tokens * 0.05),
    cacheReadTokens: Math.round(tokens * 0.7),
    cacheWriteTokens: Math.round(tokens * 0.05),
    costUsd,
  };
}

const RATE_LIMIT_PLAN: PlanDocument = {
  goal: 'Rate-limit the public paywall API per app, so one noisy app cannot starve the others.',
  plan: [
    { title: 'Add a token bucket', detail: 'One bucket per app key, in Redis, refilled every second.' },
    { title: 'Apply it to the routes', detail: 'Every public route checks the bucket before it runs.' },
    { title: 'Answer with 429', detail: 'Over the limit returns 429 with a Retry-After header.' },
  ],
  behaviour: ['An app over its limit gets 429 with Retry-After.', 'Other apps are unaffected.'],
  approach: 'A sliding token bucket in Redis keyed by app id, checked in the API middleware.',
  files: [{ path: 'src/api/middleware/rate-limit.ts', change: 'New middleware.' }],
  outOfScope: ['Per-user limits.'],
  verification: ['A load test that floods one app while another keeps working.'],
  questions: [],
};

const RATE_LIMIT_REVISED: PlanDocument = {
  ...RATE_LIMIT_PLAN,
  plan: [
    RATE_LIMIT_PLAN.plan[0] as PlanDocument['plan'][number],
    { title: 'Read limits from the plan', detail: 'Each billing plan sets its own requests per second.' },
    RATE_LIMIT_PLAN.plan[1] as PlanDocument['plan'][number],
    RATE_LIMIT_PLAN.plan[2] as PlanDocument['plan'][number],
  ],
  approach:
    'A sliding token bucket in Redis keyed by app id, sized from the app’s billing plan, checked in the API middleware.',
};

const ESCALATED_FINDINGS: ReviewFinding[] = [
  {
    severity: 'blocking',
    file: 'src/export/clickhouse.ts',
    line: 42,
    end: 48,
    message: 'The retry keeps the offset in memory; a restart mid-export starts the chunk from zero again.',
  },
  {
    severity: 'blocking',
    file: 'src/export/chunks.ts',
    line: 18,
    message: 'Three retries with no backoff hammer ClickHouse when it is already slow.',
  },
  {
    severity: 'suggestion',
    file: null,
    line: null,
    message: 'Log the attempt number so a slow export is easy to spot.',
  },
];

interface SeedRepoPair {
  paywall: Repo;
  kanna: Repo;
}

function listLimitTasks({ paywall, kanna }: SeedRepoPair): SeedTask[] {
  return [
    {
      id: 'task-rate-limit',
      intent: 'Rate-limit the public paywall API per app',
      title: 'Rate-limit the public API per app',
      repo: paywall,
      size: 'large',
      planFirst: true,
      stage: 'awaiting_plan',
      reason: 'needs the revised plan approved',
      branch: 'feat/api-rate-limit',
      ageHours: 3,
      spec: RATE_LIMIT_PLAN,
      runs: [
        { role: 'planner', minutes: 6, summary: 'Proposed a token bucket per app.' },
        { role: 'planner', minutes: 4, summary: 'Revised the plan to read limits from the billing plan.' },
      ],
      extra: [
        {
          type: 'spec.proposed',
          taskId: 'task-rate-limit',
          body: RATE_LIMIT_REVISED.goal,
          document: RATE_LIMIT_REVISED,
          changeSummary: 'Limits now come from the app’s billing plan instead of one global number.',
          feedback: 'Enterprise apps need higher limits than free ones.',
        },
      ],
      gate: {
        kind: 'spec',
        title: 'Approve the rate-limit plan',
        body: 'Version 2 reads limits from the billing plan.',
        details: { planVersion: 2 },
      },
    },
    {
      id: 'task-export-backoff',
      intent: 'ClickHouse export retries need to survive a restart',
      title: 'Make export retries survive a restart',
      repo: paywall,
      size: 'small',
      stage: 'awaiting_review',
      reason: 'the agents could not settle the review',
      branch: 'fix/export-retry-restart',
      ageHours: 4,
      summary: 'Retries now resume from the last written chunk.',
      findings: ESCALATED_FINDINGS,
      runs: [
        { role: 'builder', minutes: 9, summary: 'Persisted the chunk offset.' },
        { role: 'reviewer', minutes: 3, summary: 'Two blocking findings.' },
        { role: 'fixer', minutes: 6, summary: 'Moved the offset into the export row.' },
        { role: 'reviewer', minutes: 3, summary: 'The same two findings again.' },
      ],
      extra: [
        { type: 'run.metered', runId: 'task-export-backoff-run-0', usage: createRunUsage(1.84, 920_000) },
        { type: 'run.metered', runId: 'task-export-backoff-run-1', usage: createRunUsage(0.31, 210_000) },
        { type: 'run.metered', runId: 'task-export-backoff-run-2', usage: createRunUsage(1.12, 640_000) },
        { type: 'run.metered', runId: 'task-export-backoff-run-3', usage: createRunUsage(0.29, 190_000) },
        {
          type: 'review.escalated',
          taskId: 'task-export-backoff',
          escalation: { reason: 'rounds', rounds: 2, at: NOW - 20 * MINUTE },
        },
        {
          type: 'task.suggested',
          taskId: 'task-export-backoff',
          suggestion: {
            id: 'suggestion-export-metrics',
            runId: 'task-export-backoff-run-1',
            title: 'Chart export durations per app',
            intent:
              'Add a dashboard panel with ClickHouse export durations per app, so slow exports show up early.',
            why: 'The review found slow exports only by reading logs.',
            waitsOnThis: true,
            status: 'open',
            createdTaskId: null,
            suggestedAt: NOW - 25 * MINUTE,
          },
        },
      ],
      gate: {
        kind: 'review',
        title: 'Decide on the review findings',
        body: 'The reviewer still had blocking findings after 2 fix rounds.',
        details: { escalation: { reason: 'rounds', rounds: 2, at: NOW - 20 * MINUTE } },
      },
    },
    {
      id: 'task-kanna-setup',
      intent: 'add keyboard shortcuts to the kanna sidebar',
      title: 'Keyboard shortcuts in the sidebar',
      repo: kanna,
      size: 'small',
      stage: 'triage',
      reason: 'waiting for the setup to be fixed',
      branch: 'feat/sidebar-shortcuts',
      ageHours: 1,
      extra: [
        {
          type: 'config.verified',
          taskId: 'task-kanna-setup',
          problems: [
            {
              kind: 'check_commands',
              detail:
                'No check commands are set, and package.json has no lint, check-types, typecheck or test script to run.',
            },
          ],
        },
      ],
      gate: {
        kind: 'question',
        purpose: 'configuration',
        title: 'No checks to run',
        body: 'Checks: no check commands are set.',
      },
    },
  ];
}

function listWaitTasks({ paywall }: SeedRepoPair): SeedTask[] {
  return [
    {
      id: 'task-staging-deploy',
      intent: 'verify the paywall CDN purge on staging after the deploy',
      title: 'Verify the CDN purge on staging',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'waiting for the staging deploy',
      branch: 'fix/cdn-purge',
      ageHours: 1.5,
      runs: [{ role: 'builder', minutes: 7, summary: 'Purged the CDN; waiting for the deploy to verify.' }],
      extra: [
        {
          type: 'run.ended',
          runId: 'task-staging-deploy-run-0',
          outcome: 'completed',
          summary: 'Waiting for the staging deploy.',
        },
        {
          type: 'monitor.armed',
          taskId: 'task-staging-deploy',
          monitor: {
            id: 'monitor-staging',
            runId: 'task-staging-deploy-run-0',
            role: 'builder',
            phaseIndex: 1,
            notes: 'The staging deploy of `main@4f2c1e9`. Ready when /healthz reports that sha.',
            armedAt: NOW - 18 * MINUTE,
            nextCheckAt: NOW + 12 * MINUTE,
            timeoutAt: NOW + 3 * 60 * MINUTE,
            attempts: 1,
            maxAttempts: 10,
            status: 'armed',
          },
        },
      ],
    },
    {
      id: 'task-wait-ran-out',
      intent: 'confirm the new pricing page renders on the production CDN after the release',
      title: 'Confirm the pricing page on the CDN',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'paused',
      branch: 'fix/pricing-cdn-check',
      ageHours: 6,
      runs: [{ role: 'builder', minutes: 5, summary: 'The wait ran out.' }],
      extra: [
        {
          type: 'run.ended',
          runId: 'task-wait-ran-out-run-0',
          outcome: 'completed',
          summary: 'The wait ran out.',
        },
        {
          type: 'monitor.armed',
          taskId: 'task-wait-ran-out',
          monitor: {
            id: 'monitor-pricing',
            runId: 'task-wait-ran-out-run-0',
            role: 'builder',
            phaseIndex: 1,
            notes: 'The 2.14 release on the production CDN. Ready when /pricing serves the new hero.',
            armedAt: NOW - 5 * 60 * MINUTE,
            nextCheckAt: NOW - 30 * MINUTE,
            timeoutAt: NOW + 19 * 60 * MINUTE,
            attempts: 10,
            maxAttempts: 10,
            status: 'armed',
          },
        },
        {
          type: 'monitor.ended',
          taskId: 'task-wait-ran-out',
          monitorId: 'monitor-pricing',
          status: 'exhausted',
        },
      ],
      gate: {
        kind: 'question',
        purpose: 'failure',
        title: 'The agent’s wait ran out of checks',
        body: 'The agent was waiting for: The 2.14 release on the production CDN. Ready when /pricing serves the new hero.\n\nThe agent used all 10 checks and still needed to wait. Retry to wake an agent with a fresh set of checks, or cancel the task.',
        details: { cause: 'monitor', runId: null },
      },
    },
    {
      id: 'task-quiet-build',
      intent: 'regenerate the paywall template thumbnails',
      title: 'Regenerate the template thumbnails',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'building',
      branch: 'chore/template-thumbnails',
      ageHours: 0.8,
      runs: [{ role: 'builder', minutes: 30, summary: 'Rendering every template.' }],
      extra: [{ type: 'run.silenced', runId: 'task-quiet-build-run-0', since: NOW - 22 * MINUTE }],
    },
  ];
}

function listBudgetTasks({ paywall }: SeedRepoPair): SeedTask[] {
  return [
    {
      id: 'task-budget-cap',
      intent: 'migrate the paywall analytics to the new event schema',
      title: 'Migrate analytics to the new event schema',
      repo: paywall,
      size: 'large',
      stage: 'building',
      reason: 'reached its usage limit',
      branch: 'refactor/analytics-schema',
      ageHours: 7,
      runs: [
        { role: 'planner', minutes: 6, summary: 'Planned four phases.' },
        { role: 'builder', minutes: 40, summary: 'Ported the first two event families.' },
      ],
      extra: [
        {
          type: 'run.ended',
          runId: 'task-budget-cap-run-1',
          outcome: 'completed',
          summary: 'Ported the first two event families.',
        },
        {
          type: 'run.metered',
          runId: 'task-budget-cap-run-0',
          usage: createRunUsage(0.62, 380_000),
          weeklyPercent: 1.4,
        },
        {
          type: 'run.metered',
          runId: 'task-budget-cap-run-1',
          usage: createRunUsage(4.71, 2_600_000),
          weeklyPercent: 10.7,
        },
      ],
      gate: {
        kind: 'question',
        purpose: 'failure',
        title: 'Reached its usage limit',
        body: 'This task has used 12% of the weekly usage limit, past its 10% limit, so the next step did not start. Continue to allow another 10%, or cancel the task.',
        details: { cause: 'budget', runId: null },
      },
    },
    {
      id: 'task-retry-question',
      intent: 'retry webhook deliveries that fail',
      title: 'Retry failed webhook deliveries',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'waiting on your answer',
      branch: 'fix/webhook-retries',
      ageHours: 0.5,
      runs: [{ role: 'builder', minutes: 4, summary: 'Asked how long to keep retrying.' }],
      gate: {
        kind: 'question',
        purpose: 'agent_question',
        title: 'How long should a failing webhook keep retrying?',
        body: 'Stripe retries for 3 days with exponential backoff. Shorter keeps the queue small; longer survives a customer outage.',
        details: { choices: ['1 hour', '24 hours', '3 days'], recommendation: '24 hours' },
      },
    },
    {
      id: 'task-ask-export',
      intent: 'How does the ClickHouse export decide how big a chunk is?',
      title: 'How the export sizes its chunks',
      repo: paywall,
      size: 'small',
      shape: 'answer',
      stage: 'done',
      reason: 'answered your question',
      branch: 'ask/export-chunks',
      ageHours: 2.5,
      runs: [{ role: 'answerer', minutes: 3, summary: 'Answered the question.' }],
      extra: [
        { type: 'run.metered', runId: 'task-ask-export-run-0', usage: createRunUsage(0.18, 140_000) },
        {
          type: 'task.answered',
          taskId: 'task-ask-export',
          runId: 'task-ask-export-run-0',
          answer: [
            'Chunks are a fixed **50,000 rows**, set by `CHUNK_ROWS` in [chunks.ts](shinsa://file/src/export/chunks.ts#L4).',
            '',
            '`planChunks` counts the rows once, then walks them in steps of that size; nothing adapts to the app’s size or to how slow ClickHouse is.',
          ].join('\n'),
        },
        {
          type: 'task.suggested',
          taskId: 'task-ask-export',
          suggestion: {
            id: 'suggestion-adaptive-chunks',
            runId: 'task-ask-export-run-0',
            title: 'Size export chunks by response time',
            intent:
              'Make the ClickHouse export shrink its chunk size when a chunk takes longer than 10 seconds.',
            why: 'Fixed 50k-row chunks time out on the largest apps.',
            waitsOnThis: false,
            status: 'open',
            createdTaskId: null,
            suggestedAt: NOW - 2 * 60 * MINUTE,
          },
        },
      ],
    },
  ];
}

export function listProcessTasks(repos: SeedRepoPair): SeedTask[] {
  return [...listLimitTasks(repos), ...listWaitTasks(repos), ...listBudgetTasks(repos)];
}
