import { type Gate, SHAPE_PIPELINES, type ShinsaState, type Task, type TaskShape } from '@shinsa/core';
import { createSampleGate, createSampleState, createSampleTask, MINUTE } from '@/routes/ui/samples.ts';
import { createPullRequest, PROJECT } from './scene.ts';

export const KIND_ORDER: TaskShape[] = ['answer', 'investigate', 'research', 'change', 'fix', 'operation'];

export const KIND_ENDS: Record<TaskShape, string> = {
  answer: 'Ends with an answer, read from the repository. Nothing changes.',
  investigate: 'Ends with a diagnosis: the cause, and how it was reproduced in a scratch worktree.',
  research: 'Ends with a report: a comparison or a recommendation.',
  change: 'Plan, build, checks and an agent review, then your review. Ends with a merged pull request.',
  fix: 'Finds the cause first, then asks before it changes anything.',
  operation: 'A one-off action in the repository. The plan always waits for your approval.',
};

interface KindScene {
  task: Task;
  gate: Gate | null;
}

function base(now: number, shape: TaskShape, overrides: Partial<Task> & { title: string }) {
  return createSampleTask(now, {
    id: `kind-${shape}`,
    handle: `NW-${160 + KIND_ORDER.indexOf(shape)}`,
    projectId: PROJECT.id,
    repoId: 'api',
    pipeline: [...SHAPE_PIPELINES[shape]],
    ...overrides,
  });
}

function result(now: number, shape: 'answer' | 'investigate' | 'research', title: string, body: string) {
  return base(now, shape, {
    title,
    stage: 'done',
    stageReason: 'done',
    result: { step: shape, body, runId: null, at: now - 2 * MINUTE },
  });
}

function createKindScenes(now: number): Record<TaskShape, KindScene> {
  const fix = base(now, 'fix', {
    title: 'Refunds over €1,000 fail',
    stage: 'awaiting_proposal',
    stageReason: 'a proposal waits for your OK',
    result: {
      step: 'investigate',
      body: 'Refunds over €1,000 are sent in cents to an endpoint that expects euros, and the provider rejects anything over its €100,000 limit.',
      runId: null,
      at: now - 3 * MINUTE,
    },
    proposal: {
      request: 'Send refund amounts in euros in `refunds/provider.ts`, and add a test for a €1,250 refund.',
      why: 'The amount is converted twice. The fix is one line and a test.',
      status: 'open',
      runId: null,
      at: now - 3 * MINUTE,
    },
  });
  const operation = base(now, 'operation', {
    title: 'Backfill missing order currencies',
    stage: 'awaiting_plan',
    stageReason: 'plan to approve',
    plan: {
      version: 1,
      body: '',
      proposedAt: now - 4 * MINUTE,
      document: {
        goal: 'Every order from before March has a currency, so exports stop defaulting to USD.',
        phases: [],
        behaviour: [],
        approach: '',
        files: [],
        outOfScope: [],
        verification: [],
        questions: [],
        operation: [
          'Run `bun scripts/backfill-currency.ts --dry-run` and check it reports about 8,200 orders.',
          'Run it without `--dry-run`, in batches of 500.',
        ],
        impact:
          'Sets `currency` on about 8,200 orders from their store’s default. The script logs every id it changed.',
        approval: true,
      },
    },
  });
  const change = base(now, 'change', {
    title: 'Add Apple Pay to checkout',
    repoId: 'web',
    stage: 'awaiting_merge',
    stageReason: 'ready to merge',
    branch: 'feat/apple-pay',
    phases: [
      { status: 'done', at: now - 50 * MINUTE },
      { status: 'done', at: now - 35 * MINUTE },
      { status: 'done', at: now - 20 * MINUTE },
    ],
    checkResults: [
      { name: 'bun lint', outcome: 'pass', detail: null },
      { name: 'bun check-types', outcome: 'pass', detail: null },
      { name: 'bun run test', outcome: 'pass', detail: '318 tests, 6 new' },
    ],
    pullRequest: createPullRequest(now, 812),
  });
  return {
    answer: {
      task: result(
        now,
        'answer',
        'Where is sales tax calculated?',
        [
          'In `pricing/tax.ts`, from the store’s region, after discounts and before shipping:',
          '',
          '```ts',
          'export function applyTax(cart: Cart, region: Region) {',
          '  const taxable = cart.subtotal - cart.discounts;',
          '  return round(taxable * region.taxRate);',
          '}',
          '```',
          '',
          '`checkout/total.ts` is the only caller.',
        ].join('\n')
      ),
      gate: null,
    },
    investigate: {
      task: result(
        now,
        'investigate',
        'Why do nightly exports stall?',
        [
          '**Cause.** Each export chunk takes a database connection and never gives it back when the chunk times out. After about 40 timeouts the pool is empty and every export waits.',
          '',
          '**Reproduced** in a scratch worktree:',
          '1. Set the chunk timeout to 2 seconds.',
          '2. Ran last night’s export against a copy of the data.',
          '3. The 41st chunk waited for a connection until the job was killed.',
          '',
          '**Where.** `exports/run-chunk.ts`, the `catch` that skips `release()`.',
        ].join('\n')
      ),
      gate: null,
    },
    research: {
      task: result(
        now,
        'research',
        'Which payment providers support Apple Pay in the EU?',
        [
          '| Provider | Apple Pay | Extra fee | Setup per store |',
          '| --- | --- | --- | --- |',
          '| Stripe | Yes | None | None |',
          '| Adyen | Yes | None | Merchant ID |',
          '| Mollie | Yes | None | Domain check |',
          '',
          '**Recommendation.** Stripe: we already use it for cards, so Apple Pay is a setting and a button.',
        ].join('\n')
      ),
      gate: null,
    },
    change: {
      task: change,
      gate: createSampleGate(now, {
        id: 'kind-change-gate',
        taskId: change.id,
        type: 'merge',
        title: 'Merge the pull request',
        openedAt: now - 6 * MINUTE,
      }),
    },
    fix: {
      task: fix,
      gate: createSampleGate(now, {
        id: 'kind-fix-gate',
        taskId: fix.id,
        type: 'proposal',
        title: 'Turn this investigation into a fix?',
        body: `${fix.proposal?.why}\n\n${fix.proposal?.request}`,
      }),
    },
    operation: {
      task: operation,
      gate: createSampleGate(now, {
        id: 'kind-operation-gate',
        taskId: operation.id,
        type: 'plan',
        title: 'Approve the plan',
        planVersion: 1,
      }),
    },
  };
}

export function createKindsState(now: number): { state: ShinsaState; scenes: Record<TaskShape, KindScene> } {
  const scenes = createKindScenes(now);
  const state = createSampleState({
    tasks: KIND_ORDER.map((shape) => scenes[shape].task),
    gates: KIND_ORDER.flatMap((shape) => scenes[shape].gate ?? []),
  });
  return { state, scenes };
}
