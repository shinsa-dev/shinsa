import type { ChatTool, Repo, RunRole, PlanDocument, TriageDecisions } from '../packages/core/src/index.ts';
import type { SeedTask } from './seed-kit.ts';

const AUTO = { shape: true, start: true, priority: true };

const LEAK_FINDINGS = [
  'The nightly export opens one ClickHouse connection per chunk in `exportChunk` and only releases it on success.',
  'When a chunk times out the connection stays checked out, so after about 40 slow chunks the pool is empty and every later chunk waits forever.',
  'It only shows at night because that is when the large apps export and chunks time out.',
].join('\n\n');

const LEAK_PROPOSAL = {
  request:
    'Release the ClickHouse connection in `exportChunk` when a chunk times out, and cap the pool at 20.',
  why: 'The stall comes from leaked connections, and the fix is a few lines in one function.',
};

const ROTATE_PLAN: PlanDocument = {
  goal: 'Rotate the webhook signing secret for every app without dropping a delivery.',
  plan: [
    { title: 'Issue the new secrets', detail: 'Create a second secret per app and accept both for a day.' },
    { title: 'Switch the signer', detail: 'Sign with the new secret once every app has it.' },
    { title: 'Retire the old secrets', detail: 'Remove the old secret after a day without failures.' },
  ],
  behaviour: ['Deliveries keep verifying during the switch.'],
  approach: 'Two secrets per app for a day, then one.',
  files: [],
  outOfScope: ['Changing the signing algorithm.'],
  verification: ['A delivery signed with either secret verifies during the overlap.'],
  questions: [],
  impact:
    'Adds a second secret to each of the 412 apps with webhooks; no delivery changes until the switch. The dry run lists the 412 apps and signs a test delivery with both secrets. Undo by removing the new secrets before the switch.',
};

const BACKFILL_STEPS = [
  'Run `bun scripts/backfill-plan-tier.ts --dry-run` and check it lists 1,240 accounts without a tier.',
  'Run it without `--dry-run` in batches of 200, and check the count of accounts without a tier reaches 0.',
];

const BACKFILL_IMPACT =
  'Writes `plan_tier` on the 1,240 accounts that have none, from their latest invoice. The dry run lists every account and the tier it would get. Undo by setting `plan_tier` back to null for the accounts in `backfill-plan-tier.csv`.';

const TIER_PLAN: PlanDocument = {
  goal: 'Store each account’s plan tier, then backfill it for the accounts that have none.',
  plan: [
    { title: 'Add the column', detail: 'A nullable `plan_tier` column, written on every invoice.' },
    {
      title: 'Read it in billing',
      detail: 'Billing reads `plan_tier` and falls back to the invoice when null.',
    },
  ],
  behaviour: ['New invoices write the tier.', 'Billing shows the same tier as before for every account.'],
  approach: 'Ship the column and the writer first, then backfill the old accounts once it is live.',
  files: [{ path: 'src/billing/tier.ts', change: 'Read and write `plan_tier`.' }],
  outOfScope: ['Changing how tiers are priced.'],
  verification: [
    'A test writes an invoice and reads the tier back.',
    'The billing page shows the same tier for 20 sampled accounts before and after.',
  ],
  questions: [],
  operation: BACKFILL_STEPS,
  impact: BACKFILL_IMPACT,
};

const TRIAL_BACKFILL_PLAN: PlanDocument = {
  goal: 'Every April trial has a start date, read from its first purchase event.',
  plan: [
    { title: 'Dry run', detail: 'List the trials without a start date and the date each would get.' },
    { title: 'Backfill', detail: 'Write the dates in batches of 500.' },
  ],
  behaviour: ['Every April trial shows its start date.'],
  approach: 'Read the first purchase event of each trial; skip trials that have none and list them.',
  files: [],
  outOfScope: ['Trials from other months.'],
  verification: [],
  questions: [],
  operation: [
    'Run `bun scripts/backfill-trial-start.ts --month 2026-04 --dry-run` and check it lists 1,296 trials.',
    'Run it without `--dry-run` in batches of 500, and check no April trial is left without a start date or a row in `backfill-skipped.csv`.',
  ],
  impact:
    'Writes `trial_started_at` on the 1,296 April trials that have none. The dry run lists every trial and the date it would get. Undo by clearing `trial_started_at` for the trials in `backfill-written.csv`.',
};

const TIER_MERGE_COMMIT = '9f3c2b17e4a8d6051c2be0f7a1d34c9e8b6f2a10';

const TIER_GATE_BODY = [
  `Pull request #4618 merged as \`${TIER_MERGE_COMMIT.slice(0, 7)}\`. The merged code can differ from the plan you approved, so check it before the operation runs.`,
  '',
  '## Operation',
  ...BACKFILL_STEPS.map((step, index) => `${index + 1}. ${step}`),
  '',
  '## Impact',
  BACKFILL_IMPACT,
].join('\n');

const RISKY_PLAN: PlanDocument = {
  goal: 'Move session tokens from local storage to an http-only cookie.',
  plan: [
    { title: 'Issue the cookie', detail: 'Sign in sets an http-only, same-site cookie next to the token.' },
    { title: 'Read the cookie', detail: 'The API accepts the cookie and the header for a week.' },
    { title: 'Drop the token', detail: 'Stop writing the token to local storage.' },
  ],
  behaviour: ['Signed-in users stay signed in through the switch.'],
  approach: 'Accept both for a week so no session is dropped, then remove the old path.',
  files: [{ path: 'src/auth/session.ts', change: 'Set and read the cookie.' }],
  outOfScope: ['Single sign-on.'],
  verification: [
    'An end-to-end test signs in, reloads and stays signed in with only the cookie.',
    'A screenshot of the storage panel shows no token in local storage.',
  ],
  questions: [],
  evidence: ['screenshot', 'test'],
  checks: ['bun test test/auth'],
  approval: true,
};

const ANSWER_DECISIONS: TriageDecisions = {
  shape: { value: 'answer', why: 'It asks how the retries work, not for a change.' },
  start: { value: [], why: 'Nothing it reads is being changed right now.' },
  priority: { value: 'normal', why: 'Nothing is waiting on the answer.' },
};

const CHANGE_DECISIONS: TriageDecisions = {
  shape: { value: 'change', why: 'It asks for a new setting in the editor.' },
  start: { value: [], why: 'No open task touches the editor settings.' },
  priority: { value: 'normal', why: 'No other task waits on it.' },
};

const STUCK_FINDINGS = [
  'Two exports from last night still hold the export lock in `export_locks`, so every later run waits on them.',
  'Both belong to workers that were killed during the 02:10 deploy; nothing else holds the lock.',
].join('\n\n');

const COMPOSED_WHY = 'Find what holds the exports first, then clear it with a one-off script.';

const OPERATE_NEXT = 'Plan the operation. You approve the plan before anything runs.';

const SHAPE_HANDOVER: Partial<Record<RunRole, (body: string) => ChatTool>> = {
  answerer: (body) => ({ kind: 'shinsa', name: 'answer', args: { answer: body } }),
  investigator: (body) => ({ kind: 'shinsa', name: 'report_diagnosis', args: { findings: body } }),
  researcher: (body) => ({ kind: 'shinsa', name: 'submit_report', args: { report: body } }),
  operator: (body) => ({ kind: 'shinsa', name: 'report_outcome', args: { outcome: body } }),
};

export function resolveShapeHandover(role: RunRole, body: string) {
  return SHAPE_HANDOVER[role]?.(body) ?? null;
}

interface SeedRepoPair {
  paywall: Repo;
  kanna: Repo;
}

function listInquiryShapeTasks({ paywall, kanna }: SeedRepoPair): SeedTask[] {
  return [
    {
      id: 'task-shape-investigating',
      intent: 'Find out why the paywall preview flickers on Safari',
      title: 'Why the preview flickers on Safari',
      repo: paywall,
      size: 'small',
      shape: 'investigate',
      stage: 'investigating',
      reason: 'investigating',
      branch: 'investigate/preview-flicker',
      ageHours: 0.4,
      runs: [{ role: 'investigator', minutes: 6, summary: 'Reproducing the flicker.' }],
    },
    {
      id: 'task-shape-findings',
      intent: 'Investigate why webhook retries double-send on deploys',
      title: 'Why webhook retries double-send',
      repo: paywall,
      size: 'small',
      shape: 'investigate',
      stage: 'done',
      reason: 'reported its findings',
      branch: 'investigate/webhook-double-send',
      ageHours: 7,
      summary:
        'The retry worker and the deploy drain both pick up in-flight deliveries, because the lock is released before the drain finishes. Only deliveries in flight during a deploy are affected.',
      runs: [
        {
          role: 'investigator',
          minutes: 11,
          summary: 'Found the race between the drain and the retry worker.',
        },
      ],
      extra: [
        {
          type: 'task.delivered',
          taskId: 'task-shape-findings',
          step: 'investigate',
          body: 'The retry worker and the deploy drain both pick up in-flight deliveries, because the lock is released before the drain finishes.\n\nOnly deliveries in flight during a deploy are affected, about 30 a deploy.',
          runId: 'task-shape-findings-run-0',
        },
      ],
    },
    {
      id: 'task-shape-change-gate',
      intent: 'Investigate why exports stall at night',
      title: 'Why exports stall at night',
      repo: paywall,
      size: 'small',
      shape: 'investigate',
      stage: 'awaiting_proposal',
      reason: 'a change is proposed for you to approve',
      branch: 'investigate/export-stall',
      ageHours: 2,
      summary: LEAK_FINDINGS,
      runs: [{ role: 'investigator', minutes: 14, summary: 'Found leaked ClickHouse connections.' }],
      extra: [
        {
          type: 'task.delivered',
          taskId: 'task-shape-change-gate',
          step: 'investigate',
          body: LEAK_FINDINGS,
          runId: 'task-shape-change-gate-run-0',
        },
        {
          type: 'task.change_proposed',
          taskId: 'task-shape-change-gate',
          request: LEAK_PROPOSAL.request,
          why: LEAK_PROPOSAL.why,
          runId: 'task-shape-change-gate-run-0',
        },
      ],
      gate: {
        kind: 'question',
        purpose: 'change',
        title: 'Turn this investigation into a fix?',
        body: `${LEAK_PROPOSAL.why}\n\n${LEAK_PROPOSAL.request}`,
      },
    },
    {
      id: 'task-shape-fix',
      intent: 'Checkout sometimes shows the old price after a plan change. Find the cause and fix it.',
      title: 'Find and fix the stale checkout price',
      repo: paywall,
      size: 'small',
      shape: 'fix',
      stage: 'building',
      reason: 'building the fix',
      branch: 'fix/stale-checkout-price',
      ageHours: 3,
      runs: [
        { role: 'investigator', minutes: 9, summary: 'The price cache is keyed by product, not by plan.' },
        { role: 'planner', minutes: 4, summary: 'Planned keying the cache by plan.' },
        { role: 'builder', minutes: 6, summary: 'Keying the cache by plan.' },
      ],
      extra: [
        {
          type: 'task.delivered',
          taskId: 'task-shape-fix',
          step: 'investigate',
          body: 'The price cache is keyed by product, not by plan, so a plan change keeps serving the old price for up to an hour.',
          runId: 'task-shape-fix-run-0',
        },
      ],
    },
    {
      id: 'task-shape-report',
      intent: 'Research how other paywall tools handle trial extensions',
      title: 'How other tools handle trial extensions',
      repo: kanna,
      size: 'small',
      shape: 'research',
      stage: 'done',
      reason: 'wrote the report',
      branch: 'research/trial-extensions',
      ageHours: 26,
      runs: [{ role: 'researcher', minutes: 18, summary: 'Compared four tools.' }],
      extra: [
        {
          type: 'task.delivered',
          taskId: 'task-shape-report',
          step: 'research',
          body: [
            '## Summary',
            'Three of the four tools extend a trial from the dashboard; one only through the API.',
            '',
            '## Options for us',
            '- **Dashboard action**: one button on the subscriber page. Simplest, covers support.',
            '- **API endpoint**: needed for apps that extend trials from their own backend.',
            '',
            'Both reuse the existing entitlement write, so neither needs a migration.',
          ].join('\n'),
          runId: 'task-shape-report-run-0',
        },
      ],
    },
  ];
}

function listOperationShapeTasks({ paywall }: SeedRepoPair): SeedTask[] {
  return [
    {
      id: 'task-shape-operation-plan',
      intent: 'Rotate the webhook signing secret for every app',
      title: 'Rotate the webhook signing secret',
      repo: paywall,
      size: 'small',
      shape: 'operation',
      stage: 'awaiting_plan',
      reason: 'needs the plan approved',
      branch: 'ops/rotate-webhook-secret',
      ageHours: 1,
      spec: ROTATE_PLAN,
      runs: [{ role: 'planner', minutes: 5, summary: 'Planned a rotation with a day of overlap.' }],
      gate: { kind: 'spec', title: 'Approve the rotation plan', body: ROTATE_PLAN.goal },
    },
    {
      id: 'task-shape-operation-done',
      intent: 'Backfill the missing trial start dates for April',
      title: 'Backfill April trial start dates',
      repo: paywall,
      size: 'small',
      shape: 'operation',
      stage: 'done',
      reason: 'the operation finished',
      branch: 'ops/backfill-trial-dates',
      ageHours: 30,
      spec: TRIAL_BACKFILL_PLAN,
      summary: 'Backfilled 1,284 trial start dates from the purchase events.',
      runs: [
        { role: 'planner', minutes: 4, summary: 'Planned the backfill in batches of 500.' },
        { role: 'operator', minutes: 12, summary: 'Backfilled 1,284 rows.' },
      ],
      extra: [
        {
          type: 'task.delivered',
          taskId: 'task-shape-operation-done',
          step: 'operate',
          body: 'Backfilled 1,284 trial start dates from the purchase events in 3 batches. 12 rows had no purchase event and are listed in `backfill-skipped.csv`.',
          runId: 'task-shape-operation-done-run-1',
        },
      ],
    },
  ];
}

function listComposedShapeTasks({ paywall, kanna }: SeedRepoPair): SeedTask[] {
  return [
    {
      id: 'task-shape-auto-answer',
      intent: 'How many times does a failed webhook delivery retry?',
      title: 'How webhook retries back off',
      repo: paywall,
      size: 'small',
      shape: 'answer',
      auto: AUTO,
      decisions: ANSWER_DECISIONS,
      stage: 'done',
      reason: 'answered your question',
      branch: 'ask/webhook-retries',
      ageHours: 5,
      runs: [{ role: 'answerer', minutes: 3, summary: 'Answered the question.' }],
      extra: [
        {
          type: 'task.answered',
          taskId: 'task-shape-auto-answer',
          answer: 'A failed delivery retries **5 times**, backing off 1, 5, 15, 60 and 240 minutes.',
          runId: 'task-shape-auto-answer-run-0',
        },
      ],
    },
    {
      id: 'task-shape-composed-ok',
      intent: 'The nightly exports are stuck again. Clear them so tonight’s run goes through.',
      title: 'Clear the stuck nightly exports',
      repo: paywall,
      size: 'small',
      shape: 'change',
      auto: AUTO,
      decisions: CHANGE_DECISIONS,
      composed: { pipeline: ['investigate', 'your_ok', 'plan', 'operate'], why: COMPOSED_WHY },
      stage: 'awaiting_proposal',
      reason: 'a change is proposed for you to approve',
      branch: 'ops/clear-stuck-exports',
      ageHours: 1.5,
      summary: STUCK_FINDINGS,
      runs: [
        { role: 'planner', minutes: 2, summary: COMPOSED_WHY },
        { role: 'investigator', minutes: 9, summary: 'Found two locks left by killed workers.' },
      ],
      extra: [
        {
          type: 'task.delivered',
          taskId: 'task-shape-composed-ok',
          step: 'investigate',
          body: STUCK_FINDINGS,
          runId: 'task-shape-composed-ok-run-1',
        },
        {
          type: 'task.change_proposed',
          taskId: 'task-shape-composed-ok',
          request: OPERATE_NEXT,
          why: COMPOSED_WHY,
          runId: 'task-shape-composed-ok-run-1',
        },
      ],
      gate: {
        kind: 'question',
        purpose: 'change',
        title: 'Run an operation from these findings?',
        body: `${COMPOSED_WHY}\n\n${OPERATE_NEXT}`,
      },
    },
    {
      id: 'task-shape-composed-research',
      intent: 'Pick a better date picker for the paywall editor and switch to it',
      title: 'Switch the editor’s date picker',
      repo: kanna,
      size: 'small',
      shape: 'change',
      auto: AUTO,
      decisions: CHANGE_DECISIONS,
      composed: {
        pipeline: [
          'research',
          'your_ok',
          'plan',
          'build',
          'checks',
          'agent_review',
          'your_review',
          'pull_request',
          'merge',
        ],
        why: 'Compare the date pickers first; the switch depends on which one wins.',
      },
      stage: 'researching',
      reason: 'researching',
      branch: 'feat/editor-date-picker',
      ageHours: 0.3,
      runs: [
        { role: 'planner', minutes: 2, summary: 'Set the steps: research, your OK, then the change.' },
        { role: 'researcher', minutes: 5, summary: 'Comparing three date pickers.' },
      ],
    },
    {
      id: 'task-shape-operation-confirm',
      intent: 'Store the plan tier on each account and backfill it for the old ones',
      title: 'Store and backfill the plan tier',
      repo: paywall,
      size: 'small',
      shape: 'change',
      auto: AUTO,
      decisions: CHANGE_DECISIONS,
      composed: {
        pipeline: [
          'plan',
          'build',
          'checks',
          'agent_review',
          'your_review',
          'pull_request',
          'merge',
          'operate',
        ],
        why: 'The backfill needs the column, so it runs once the change has merged.',
      },
      stage: 'awaiting_operation',
      reason: 'waiting for your OK to run the operation',
      branch: 'feat/plan-tier',
      ageHours: 0.8,
      spec: TIER_PLAN,
      merged: true,
      pullRequest: { number: 4618, checks: 'passing', mergeCommit: TIER_MERGE_COMMIT },
      runs: [
        { role: 'planner', minutes: 5, summary: 'Planned the column, then the backfill after the merge.' },
        { role: 'builder', minutes: 9, summary: 'Added the column and the writer.' },
        { role: 'builder', minutes: 6, summary: 'Billing reads the tier.' },
        { role: 'reviewer', minutes: 3, summary: 'No blocking findings.' },
      ],
      gate: {
        kind: 'question',
        purpose: 'operation',
        title: 'The change merged. Run the operation now?',
        body: TIER_GATE_BODY,
        details: {
          commit: TIER_MERGE_COMMIT,
          notes: 'Run it after 18:00 UTC, when the billing jobs are idle.',
        },
      },
    },
    {
      id: 'task-shape-plan-parameters',
      intent: 'Keep the session in an http-only cookie instead of local storage',
      title: 'Move the session to a cookie',
      repo: paywall,
      size: 'small',
      shape: 'change',
      auto: AUTO,
      decisions: CHANGE_DECISIONS,
      stage: 'awaiting_plan',
      reason: 'plan ready for you',
      branch: 'feat/session-cookie',
      ageHours: 0.5,
      spec: RISKY_PLAN,
      runs: [{ role: 'planner', minutes: 6, summary: 'Planned the switch and asked for approval first.' }],
      gate: { kind: 'spec', title: 'Move the session to a cookie', body: RISKY_PLAN.goal },
    },
    {
      id: 'task-shape-auto-change',
      intent: 'Add a setting for the default paywall font in the editor',
      title: 'Default paywall font setting',
      repo: kanna,
      size: 'small',
      shape: 'change',
      auto: AUTO,
      decisions: CHANGE_DECISIONS,
      stage: 'planning',
      reason: 'planning the work',
      branch: 'feat/default-font-setting',
      ageHours: 0.6,
      runs: [{ role: 'planner', minutes: 4, summary: 'Planning the setting.' }],
      extra: [{ type: 'task.prioritized', taskId: 'task-shape-auto-change', priority: 'high' }],
    },
  ];
}

export function listShapeTasks(repos: SeedRepoPair): SeedTask[] {
  return [
    ...listInquiryShapeTasks(repos),
    ...listOperationShapeTasks(repos),
    ...listComposedShapeTasks(repos),
  ];
}
