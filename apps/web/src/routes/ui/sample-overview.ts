import type { DeliveringStep, Monitor, PlanDocument, Task, UsageWait } from '@shinsa/core';
import { createSampleDelegations } from './sample-delegations.ts';
import {
  createSampleGate,
  createSampleRun,
  createSampleState,
  createSampleTask,
  HOUR,
  MINUTE,
} from './samples.ts';

function createUsageWaitTask(now: number, id: string, autoResume: boolean) {
  const wait: UsageWait = {
    id: `${id}-wait`,
    runId: `${id}-run`,
    role: 'agent',
    phaseIndex: 0,
    account: { id: 'team', email: 'agents@superwall.com' },
    resetAt: now + 2 * HOUR,
    armedAt: now - 10 * MINUTE,
    autoResume,
    status: 'armed',
  };
  return {
    task: createSampleTask(now, {
      id,
      title: 'Move the paywall preview to the new renderer',
      stageReason: 'waiting for the usage limit',
      usageWait: wait,
    }),
    wait,
  };
}

const BUDGET_USAGE = {
  inputTokens: 1_840_000,
  outputTokens: 92_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 5.42,
};

function listUsageHistory(now: number) {
  return Array.from({ length: 5 }, (_, index) => {
    const from = now - (5 - index * 0.5) * HOUR;
    const usage = { ...BUDGET_USAGE, costUsd: 2.71 };
    return createSampleRun(now, {
      id: `history-${index}`,
      taskId: `history-${index}`,
      status: undefined,
      startedAt: from,
      endedAt: from + 10 * MINUTE,
      outcome: 'completed',
      usage,
      meters: [
        {
          attemptId: `history-${index}`,
          window: 'account:work',
          from,
          to: from + 10 * MINUTE,
          usage,
          readings: [
            { percent: index * 6, at: from, resetsAt: null },
            { percent: index * 6 + 6, at: from + 10 * MINUTE, resetsAt: null },
          ],
        },
      ],
    });
  });
}

const POST_MERGE: Task['pipeline'] = [
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
  'operate',
];

const BACKFILL_STEPS = [
  'Run `bun scripts/backfill-currency.ts --dry-run` and check it reports about 12,400 rows.',
  'Run it without `--dry-run`, in batches of 1,000.',
  'Check that `SELECT count(*) FROM products WHERE currency IS NULL` returns 0.',
];

const BACKFILL_IMPACT =
  'Sets `currency` on about 12,400 products that have none, from their store’s default. The dry run on staging matched 12,388 rows. To undo it, set `currency` back to null for the ids the script logs.';

function createBackfillDocument(): PlanDocument {
  return {
    goal: 'Every product has a currency, so the paywall preview stops falling back to USD.',
    phases: [
      {
        title: 'Read the store’s default currency',
        detail: 'Use it when a product has none, in the editor and in the API.',
      },
      {
        title: 'Add the backfill script',
        detail: 'A dry run prints what it would change; the real run works in batches.',
      },
    ],
    behaviour: [],
    approach: '',
    files: [],
    outOfScope: [],
    verification: [
      { label: 'Currency tests', command: 'bun test apps/api/test/currency.test.ts', phases: [1] },
      { label: 'Backfill dry run', command: 'bun scripts/backfill-currency.ts --dry-run', phases: [2] },
    ],
    questions: [],
    operation: BACKFILL_STEPS,
    impact: BACKFILL_IMPACT,
    evidence: ['test', 'screenshot'],
    approval: true,
  };
}

function createBackfillGateBody() {
  return [
    'Pull request #318 merged as `9f2c4e1`. The merged code can differ from the plan you approved, so check it before the operation runs.',
    '',
    '## Operation',
    ...BACKFILL_STEPS.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Impact',
    BACKFILL_IMPACT,
  ].join('\n');
}

function createResultTask(now: number, step: DeliveringStep, title: string, body: string) {
  return createSampleTask(now, {
    id: `result-${step}`,
    title,
    stage: 'done',
    pipeline: [step],
    result: { step, body, runId: null, at: now - 2 * MINUTE },
  });
}

function createResultTasks(now: number) {
  return [
    createResultTask(
      now,
      'answer',
      'How do exports pick their chunk size?',
      'From `EXPORT_CHUNK_ROWS`, 5,000 by default. A store can lower it in its export settings.'
    ),
    createResultTask(
      now,
      'research',
      'Compare MCP v2 session timeouts',
      'Every client we checked times a session out after 5 to 10 minutes idle; none retries on its own.'
    ),
    createResultTask(
      now,
      'investigate',
      'Find out why exports stall at night',
      'Each chunk holds a ClickHouse connection and never releases it on a timeout, so the pool runs dry.'
    ),
    createResultTask(
      now,
      'operate',
      'Clear the stuck nightly exports',
      'Released the 2 export locks and restarted the queue. Last night’s exports finished in 14 minutes.'
    ),
  ];
}

function createQuietRun(now: number, id: string, minutes: number) {
  return createSampleRun(now, {
    id,
    taskId: 'quiet',
    silence: { since: now - minutes * MINUTE, snoozedUntil: null, dismissed: false },
  });
}

export function createOverviewScene(now: number) {
  const delegations = createSampleDelegations(now);
  const usageWaits = [
    createUsageWaitTask(now, 'usage-auto', true),
    createUsageWaitTask(now, 'usage-manual', false),
  ];
  const monitor: Monitor = {
    id: 'monitor-1',
    runId: 'monitor-run',
    role: 'agent',
    phaseIndex: 0,
    notes: 'The staging deploy of `paywall-next` to finish, so the preview link loads.',
    armedAt: now - 30 * MINUTE,
    nextCheckAt: now + 12 * MINUTE,
    timeoutAt: now + 3 * HOUR,
    attempts: 1,
    maxAttempts: 10,
    status: 'armed',
  };
  const tasks = {
    setup: createSampleTask(now, {
      id: 'setup',
      title: 'Add a dark mode toggle to the paywall editor',
      stage: 'triage',
      stageReason: 'waiting for the setup to be fixed',
      configProblems: [{ kind: 'default_branch', detail: 'paywall-next has no default branch.' }],
    }),
    signIn: createSampleTask(now, { id: 'sign-in', title: 'Retry failed webhook deliveries' }),
    monitor: createSampleTask(now, {
      id: 'monitor',
      title: 'Check the preview link once staging deploys',
      stageReason: 'waiting to check in again',
      phases: [{ status: 'active', at: now - HOUR }],
      monitor,
    }),
    secret: createSampleTask(now, { id: 'secret', title: 'Test the checkout flow end to end' }),
    failure: createSampleTask(now, { id: 'failure', title: 'Stream MCP tool results', stage: 'fixing' }),
    conflict: createSampleTask(now, {
      id: 'conflict',
      title: 'Move the paywall cache to the edge',
      stage: 'fixing',
      fixFor: 'conflict',
      stageReason: 'resolving conflicts with main',
      branch: 'feat/edge-cache',
      pullRequest: {
        number: 427,
        url: 'https://github.com/superwall/paywall-next/pull/427',
        state: 'open',
        base: 'main',
        checks: 'passing',
        unresolvedComments: 0,
        mergeable: false,
        updatedAt: now - 4 * MINUTE,
      },
    }),
    budget: createSampleTask(now, { id: 'budget', title: 'Rewrite the framework commands' }),
    keyed: createSampleTask(now, { id: 'keyed', title: 'Rename the billing webhooks' }),
    ranOut: createSampleTask(now, { id: 'ran-out', title: 'Check the preview link once staging deploys' }),
    question: createSampleTask(now, { id: 'question', title: 'Remove the v1 chat endpoint' }),
    review: createSampleTask(now, {
      id: 'review',
      title: 'Run the embedded chat on MCP v2',
      stage: 'awaiting_review',
      findings: [
        {
          severity: 'blocking',
          file: 'src/chat/mcp-session.ts',
          line: 88,
          message: 'The session is never closed when the chat unmounts, so sockets pile up.',
        },
        {
          severity: 'suggestion',
          file: 'src/chat/tool-result.tsx',
          line: 12,
          message: 'The empty state repeats the heading; drop the second line.',
        },
      ],
    }),
    plan: createSampleTask(now, {
      id: 'plan',
      title: 'Split the onboarding chat into steps',
      stage: 'awaiting_plan',
      plan: {
        version: 2,
        body: '',
        document: {
          goal: 'Setup asks one thing at a time, so a first run takes a minute instead of a form.',
          phases: [
            {
              title: 'Ask for the folders first',
              detail: 'Keep today’s folder picker as the opening question.',
            },
            {
              title: 'Check accounts and tools in one step',
              detail: 'One result list with a fix next to each failure.',
            },
            {
              title: 'Save each answer as it is given',
              detail: 'Leaving halfway keeps what was answered.',
            },
          ],
          behaviour: [],
          approach: '',
          files: [],
          outOfScope: [],
          verification: [],
          questions: [],
        },
        proposedAt: now - 5 * MINUTE,
        feedback: 'Keep the folder step first; people expect it.',
        changeSummary: 'Moved the folder step back to the start and merged the two account steps.',
        changes: [
          { kind: 'phase_changed', title: 'Check accounts and tools in one step' },
          { kind: 'phase_added', title: 'Save each answer as it is given' },
          { kind: 'phase_removed', title: 'Ask for a second account' },
          { kind: 'phases_reordered' },
          { kind: 'files', added: 1, removed: 2 },
        ],
      },
    }),
    suggested: createSampleTask(now, {
      id: 'suggested',
      title: 'Run the embedded chat on MCP v2',
      stage: 'merged',
      suggestions: [
        {
          id: 'retry',
          runId: null,
          title: 'Retry a dropped MCP session once',
          request: 'Retry a dropped MCP session once before showing the error.',
          why: 'Two sessions dropped during review; a single retry would have hidden both.',
          waitsOnThis: true,
          status: 'open',
          createdTaskId: null,
          suggestedAt: now - 3 * MINUTE,
        },
        {
          id: 'docs',
          runId: null,
          title: 'Document the MCP v2 settings',
          request: 'Document the MCP v2 settings in the framework docs.',
          why: 'The new timeout setting is not in the docs yet.',
          waitsOnThis: false,
          status: 'open',
          createdTaskId: null,
          suggestedAt: now - 3 * MINUTE,
        },
      ],
    }),
    quiet: createSampleTask(now, { id: 'quiet', title: 'Stream MCP tool results' }),
    shaping: createSampleTask(now, {
      id: 'shaping',
      title: 'Why does the export stall?',
      stage: 'triage',
      auto: { shape: true, start: true, priority: true },
    }),
    change: createSampleTask(now, {
      id: 'change',
      title: 'Find out why exports stall at night',
      stage: 'awaiting_proposal',
      stageReason: 'a proposal waits for your OK',
      pipeline: [
        'investigate',
        'your_ok',
        'plan',
        'build',
        'checks',
        'agent_review',
        'your_review',
        'pull_request',
        'merge',
      ],
      shapeChanges: [
        {
          from: ['investigate'],
          to: [
            'investigate',
            'your_ok',
            'plan',
            'build',
            'checks',
            'agent_review',
            'your_review',
            'pull_request',
            'merge',
          ],
          by: 'agent',
          reason: 'The stall comes from leaked connections, and the fix is two lines in one function.',
          at: now - 4 * MINUTE,
        },
      ],
      result: {
        step: 'investigate',
        body: 'The nightly export holds one ClickHouse connection per chunk and never releases it on a timeout, so the pool runs dry after about 40 chunks.',
        runId: null,
        at: now - 4 * MINUTE,
      },
      proposal: {
        request:
          'Release the ClickHouse connection in `exportChunk` when a chunk times out, and cap the pool at 20.',
        why: 'The stall comes from leaked connections, and the fix is two lines in one function.',
        status: 'open',
        runId: null,
        at: now - 4 * MINUTE,
      },
    }),
    composed: createSampleTask(now, {
      id: 'composed',
      title: 'Clear the stuck nightly exports',
      stage: 'awaiting_proposal',
      stageReason: 'a proposal waits for your OK',
      pipeline: ['investigate', 'your_ok', 'plan', 'operate'],
      result: {
        step: 'investigate',
        body: 'Two exports from last night still hold the export lock, so every later run waits on them.',
        runId: null,
        at: now - 6 * MINUTE,
      },
      proposal: {
        request: 'Plan the operation. You approve the plan before anything runs.',
        why: 'Find what holds the exports first, then clear it with a one-off script.',
        status: 'open',
        runId: null,
        at: now - 6 * MINUTE,
      },
    }),
    planned: createSampleTask(now, {
      id: 'planned',
      title: 'Backfill missing product currencies',
      stage: 'awaiting_plan',
      pipeline: POST_MERGE,
      plan: {
        version: 1,
        body: '',
        document: createBackfillDocument(),
        proposedAt: now - 5 * MINUTE,
      },
    }),
    operation: createSampleTask(now, {
      id: 'operation',
      title: 'Backfill missing product currencies',
      stage: 'awaiting_operation',
      stageReason: 'waiting for your OK to run the operation',
      pipeline: POST_MERGE,
      plan: {
        version: 1,
        body: '',
        document: createBackfillDocument(),
        proposedAt: now - 2 * HOUR,
      },
      pullRequest: {
        number: 318,
        url: 'https://github.com/superwall/paywall-next/pull/318',
        state: 'merged',
        checks: 'passing',
        unresolvedComments: 0,
        mergeable: null,
        updatedAt: now - 3 * MINUTE,
        mergeCommit: '9f2c4e1b7a3d5e60c8f1a2b3c4d5e6f708192a3b',
      },
    }),
    delegating: delegations.task,
  };
  const gates = {
    setup: createSampleGate(now, {
      id: 'setup-gate',
      taskId: 'setup',
      type: 'configuration',
      title: 'The default branch is missing',
      body: [
        'Shinsa stopped before any agent started because the setup is not complete:',
        '- paywall-next has no default branch.',
        '',
        'Set the default branch in the repository settings, then verify the setup again.',
      ].join('\n'),
    }),
    signIn: createSampleGate(now, {
      id: 'sign-in-gate',
      taskId: 'sign-in',
      type: 'sign_in',
      title: 'Paused: christo@example.com needs signing in',
      body: 'Claude signed this account out, so the agent stopped. Signing in starts the step again.',
      provider: 'claude',
      account: { id: 'side', email: 'christo@example.com' },
    }),
    secret: createSampleGate(now, {
      id: 'secret-gate',
      taskId: 'secret',
      type: 'secret',
      title: 'The checkout test needs a Stripe test key to create a payment intent.',
      runId: 'secret-run',
      secret: { label: 'Stripe test key' },
    }),
    failure: createSampleGate(now, {
      id: 'failure-gate',
      taskId: 'failure',
      title: 'Out of automatic fix rounds',
      body: '3 fix rounds did not get it clean. Retry to give the agent more rounds, or steer it in the chat.',
    }),
    budget: createSampleGate(now, {
      id: 'budget-gate',
      taskId: 'budget',
      cause: 'budget',
      title: 'Reached its usage limit',
      body: 'This task reached its usage limit of 10% of the weekly limit, so the next step did not start. Continue to allow another 10%, or cancel the task.',
    }),
    ranOut: createSampleGate(now, {
      id: 'ran-out-gate',
      taskId: 'ran-out',
      cause: 'monitor',
      title: 'The agent’s wait ran out of checks',
      body: [
        'The agent was waiting for: the staging deploy of `paywall-next` to finish.',
        'The agent used all 10 checks and still needed to wait. Retry to wake an agent with a fresh set of checks, or cancel the task.',
      ].join('\n\n'),
    }),
    question: createSampleGate(now, {
      id: 'question-gate',
      taskId: 'question',
      type: 'question',
      title: 'Should the v1 endpoint stay for one more release?',
      body: 'Two internal dashboards still call `/v1/chat`. Removing it now breaks them until they move to v2.',
      runId: 'question-run',
      choices: ['Keep v1 for one more release', 'Remove it now'],
      recommendation: 'Keep v1 for one more release',
    }),
    command: createSampleGate(now, {
      id: 'command-gate',
      taskId: 'question',
      type: 'question',
      title: 'Can you sign in to the staging database?',
      body: [
        'The migration check needs a staging session, and signing in opens your browser. Run this, then tell me when it says you are signed in:',
        '```sh run\nfly auth login\nfly proxy 5433:5432 -a shop-staging-db\n```',
        'The check then connects the way it does in CI:',
        '```bash\nDATABASE_URL=postgres://localhost:5433/shop bun run db:check\n```',
      ].join('\n\n'),
      runId: 'question-run',
    }),
    plan: createSampleGate(now, {
      id: 'plan-gate',
      taskId: 'plan',
      type: 'plan',
      title: 'Approve the plan',
      planVersion: 2,
    }),
    change: createSampleGate(now, {
      id: 'change-gate',
      taskId: 'change',
      type: 'proposal',
      title: 'Turn this investigation into a fix?',
      body: `${tasks.change.proposal?.why}\n\n${tasks.change.proposal?.request}`,
    }),
    composed: createSampleGate(now, {
      id: 'composed-gate',
      taskId: 'composed',
      type: 'proposal',
      title: 'Run an operation from this diagnosis?',
      body: `${tasks.composed.proposal?.why}\n\n${tasks.composed.proposal?.request}`,
    }),
    planned: createSampleGate(now, {
      id: 'planned-gate',
      taskId: 'planned',
      type: 'plan',
      title: 'Approve the plan',
      planVersion: 1,
    }),
    operation: createSampleGate(now, {
      id: 'operation-gate',
      taskId: 'operation',
      type: 'operation',
      title: 'The change merged. Run the operation now?',
      body: createBackfillGateBody(),
      commit: '9f2c4e1b7a3d5e60c8f1a2b3c4d5e6f708192a3b',
      openedAt: now - 3 * MINUTE,
    }),
    review: createSampleGate(now, {
      id: 'review-gate',
      taskId: 'review',
      type: 'review',
      title: 'Review the changes',
      escalation: { reason: 'rounds', rounds: 3, at: now - 8 * MINUTE },
    }),
  };
  const runs = {
    quietShort: createQuietRun(now, 'quiet-short', 6),
    quietLong: createQuietRun(now, 'quiet-long', 23),
    conflict: createSampleRun(now, { id: 'conflict-run', taskId: 'conflict', purpose: 'fix' }),
  };
  const state = createSampleState({
    tasks: [...Object.values(tasks), ...usageWaits.map((entry) => entry.task)],
    gates: Object.values(gates),
    runs: [
      ...Object.values(runs),
      createSampleRun(now, { id: 'secret-run', taskId: 'secret' }),
      createSampleRun(now, { id: 'question-run', taskId: 'question' }),
      createSampleRun(now, {
        id: 'budget-run',
        taskId: 'budget',
        status: undefined,
        endedAt: now - 2 * MINUTE,
        outcome: 'completed',
        usage: BUDGET_USAGE,
        attempts: [
          {
            attemptId: 'budget-attempt',
            provider: 'claude',
            model: null,
            resumed: false,
            handoff: null,
            startedAt: now - 40 * MINUTE,
            account: { id: 'work', email: 'work@example.com' },
          },
        ],
        meters: [
          {
            attemptId: 'budget-attempt',
            window: 'account:work',
            from: now - 40 * MINUTE,
            to: now - 2 * MINUTE,
            usage: BUDGET_USAGE,
            readings: [
              { percent: 30, at: now - 40 * MINUTE, resetsAt: null },
              { percent: 42, at: now - 2 * MINUTE, resetsAt: null },
            ],
          },
        ],
      }),
      ...listUsageHistory(now),
      createSampleRun(now, {
        id: 'keyed-run',
        taskId: 'keyed',
        status: undefined,
        endedAt: now - 5 * MINUTE,
        outcome: 'completed',
        usage: { ...BUDGET_USAGE, costUsd: 1.75 },
      }),
      ...delegations.runs,
    ],
    taskUsageLimit: 10,
  });
  return { state, tasks, gates, runs, usageWaits, monitor, results: createResultTasks(now) };
}
