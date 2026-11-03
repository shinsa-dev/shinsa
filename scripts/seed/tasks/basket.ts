import {
  type AgentReply,
  type PlanDocument,
  type Repo,
  SHAPE_PIPELINES,
  serializePlanMarkdown,
} from '../../../packages/core/src/index.ts';
import { createPlanCheck, listSeedIterations, type SeedTask } from '../kit.ts';

const PLAN_TIER_PLAN: PlanDocument = {
  goal: 'Every list knows its owner’s plan tier, so the server can enforce the shared-list limit without asking Stripe on each request.',
  phases: [
    { title: 'Add the column', detail: 'A nullable `plan_tier` on `lists`, with a migration.' },
    {
      title: 'Write it on change',
      detail: 'The Stripe webhook updates the tier of every list its owner has.',
    },
    { title: 'Enforce the limit', detail: 'Free owners get 3 shared lists; the API answers 402 past it.' },
  ],
  behaviour: [
    'A new list gets its owner’s tier.',
    'Upgrading in Stripe updates every list within a minute.',
    'A free owner’s fourth shared list is refused with a clear message.',
  ],
  approach:
    'The column stays nullable until the backfill has run, so the deploy never blocks on it. The limit check reads the column only.',
  files: [
    { path: 'src/db/schema.ts', change: 'The `plan_tier` column.' },
    { path: 'src/billing/webhook.ts', change: 'Writes the tier on subscription changes.' },
  ],
  outOfScope: ['Changing the prices or the tiers themselves.'],
  verification: [
    createPlanCheck('Webhook writes the tier', 'bun test test/billing/webhook.test.ts', [2, 3]),
    createPlanCheck('Shared-list limit per tier', 'bun test test/lists/limit.test.ts', [3]),
  ],
  questions: [],
  impact:
    'Writes `plan_tier` on the 18,402 lists that have none, from their owner’s subscription. The dry run lists every list and the tier it would get. Undo by setting `plan_tier` back to null; the limit check treats null as the free tier.',
  operation: [
    'Run `bun scripts/backfill-plan-tier.ts --dry-run` against production and check it reports 18,402 lists to update.',
    'Run it without `--dry-run` in batches of 1,000 and check `select count(*) from lists where plan_tier is null` is 0.',
  ],
};

const PLAN_TIER_REQUEST =
  'Backfill in batches so the database never locks, and skip lists whose owner has no subscription. Do we need a dry run at all?';

const PLAN_TIER_REPLY: AgentReply = {
  headline:
    'The backfill now runs in batches of 1,000 and leaves lists without a subscription on the free tier.',
  points: [
    {
      ask: 'Backfill in batches so the database never locks',
      outcome: 'done',
      note: 'The second operation step writes 1,000 lists per batch and checks the count after.',
    },
    {
      ask: 'Skip lists whose owner has no subscription',
      outcome: 'done',
      note: 'They keep a null `plan_tier`, which the limit check reads as free.',
    },
    {
      ask: 'Do we need a dry run at all?',
      outcome: 'answered',
      note: 'Yes: it is the only check before 18,402 rows change, and it costs one read.',
    },
  ],
  next: null,
};

const BASKET_SYNC_FOLLOW_UP = 'And what happens when the app is offline for a day?';

const BASKET_SYNC_FOLLOW_UP_ANSWER =
  'Edits queue in `PendingEdits` on disk while the app is offline. On the next foreground with a connection, `ListSync` pushes them oldest first, then pulls; a list edited on both sides keeps the server version of each item and the local version of the order.';

const BASKET_SYNC_REPLY: AgentReply = {
  headline: 'Offline edits wait on disk and sync, oldest first, the next time the app comes online.',
  points: [
    {
      ask: 'What happens when the app is offline for a day?',
      outcome: 'answered',
      note: 'Nothing is lost: `PendingEdits` keeps every edit until the next push succeeds.',
    },
  ],
  next: null,
};

export function listBasketTasks({
  basketServer,
  basketSdk,
}: {
  basketServer: Repo;
  basketSdk: Repo;
}): SeedTask[] {
  return [
    {
      id: 'task-basket-plan-tier',
      request:
        'Store each list owner’s plan tier on the list and enforce the shared-list limit, then backfill the tier for existing lists once it ships.',
      title: 'Plan tier on lists, then backfill it',
      repo: basketServer,
      size: 'small',
      shape: 'change',
      composed: {
        pipeline: [...SHAPE_PIPELINES.change, 'operate'],
        why: 'The column has to ship before the existing lists can be backfilled.',
      },
      stage: 'awaiting_plan',
      reason: 'plan ready for you',
      branch: 'feat/plan-tier-on-lists',
      ageHours: 0.8,
      plan: PLAN_TIER_PLAN,
      runs: [
        { role: 'agent', purpose: 'plan', minutes: 4, summary: 'Proposed the plan.' },
        {
          role: 'agent',
          purpose: 'plan',
          minutes: 3,
          summary: 'Revised the plan.',
          reply: 'I revised the plan: your three points are answered at the top of it.',
          handover: {
            kind: 'shinsa',
            name: 'propose_plan',
            args: { goal: PLAN_TIER_PLAN.goal, phases: PLAN_TIER_PLAN.phases, reply: PLAN_TIER_REPLY },
          },
        },
      ],
      extra: [
        ...listSeedIterations('task-basket-plan-tier', 'task-basket-plan-tier-run-1', [
          { text: PLAN_TIER_REQUEST, reply: PLAN_TIER_REPLY },
        ]),
        {
          type: 'plan.proposed',
          taskId: 'task-basket-plan-tier',
          body: PLAN_TIER_PLAN.goal,
          document: PLAN_TIER_PLAN,
        },
      ],
      gate: {
        type: 'plan',
        title: 'Plan tier on lists, then backfill it',
        body: serializePlanMarkdown(PLAN_TIER_PLAN),
        details: { planVersion: 2 },
      },
    },
    {
      id: 'task-basket-sync',
      request: 'How does the SDK decide when to sync a list with the server?',
      title: 'When the SDK syncs a list',
      repo: basketSdk,
      size: 'small',
      shape: 'answer',
      stage: 'done',
      reason: 'answered your question',
      branch: 'ask/sdk-sync',
      ageHours: 3,
      runs: [
        { role: 'answerer', minutes: 2, summary: 'Answered the question.' },
        {
          role: 'answerer',
          minutes: 2,
          summary: 'Answered your follow-up.',
          reply: 'Edits made offline are kept on disk, so nothing is lost.',
          handover: {
            kind: 'shinsa',
            name: 'answer',
            args: { answer: BASKET_SYNC_FOLLOW_UP_ANSWER, reply: BASKET_SYNC_REPLY },
          },
        },
      ],
      extra: [
        {
          type: 'task.delivered',
          taskId: 'task-basket-sync',
          step: 'answer',
          body: '`ListSync` pushes after every local edit, debounced by 2 seconds, and pulls when the app comes to the foreground.',
          runId: 'task-basket-sync-run-0',
        },
        ...listSeedIterations('task-basket-sync', 'task-basket-sync-run-1', [
          { text: BASKET_SYNC_FOLLOW_UP, reply: BASKET_SYNC_REPLY },
        ]),
        {
          type: 'task.delivered',
          taskId: 'task-basket-sync',
          step: 'answer',
          body: BASKET_SYNC_FOLLOW_UP_ANSWER,
          runId: 'task-basket-sync-run-1',
        },
      ],
    },
  ];
}
