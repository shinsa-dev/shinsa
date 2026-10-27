import {
  type MeasuredCoverage,
  type MergeStep,
  type PhaseReport,
  type PullRequest,
  type ReportTesting,
  resolveMergeStepKey,
  type Task,
} from '@shinsa/core';
import { createSampleTask } from './samples.ts';

const STEPS: MergeStep[] = [
  {
    when: 'pre_merge',
    kind: 'secret',
    title: 'Set `STRIPE_WEBHOOK_SECRET` in production',
    detail:
      'In the API service’s production environment on Railway. Copy the signing secret from the webhook endpoint in the Stripe dashboard.',
    command: null,
  },
  {
    when: 'pre_merge',
    kind: 'config',
    title: 'Add the webhook endpoint in Stripe',
    detail:
      'Point it at `https://api.paywall.dev/webhooks/stripe` and send `invoice.paid` and `invoice.payment_failed`.',
    command: null,
  },
  {
    when: 'post_merge',
    kind: 'migration',
    title: 'Run the invoices migration',
    detail: 'Adds the `invoices` table the webhook writes to. It takes a few seconds and locks nothing.',
    command: 'bun run --cwd apps/api db:migrate',
  },
  {
    when: 'post_merge',
    kind: 'deploy',
    title: 'Redeploy the worker',
    detail: 'The worker reads the new queue only after a restart.',
    command: 'railway redeploy --service worker',
  },
];

export const TESTING: ReportTesting = {
  automated: [
    'Unit tests cover the signature check, a replayed event and a payment that fails, against recorded Stripe payloads.',
  ],
  manual: [
    {
      action: 'Forward Stripe’s test events to your local API.',
      target: { kind: 'command', value: 'stripe listen --forward-to localhost:4000/webhooks/stripe' },
      expect: 'The CLI prints `Ready!` and the webhook signing secret.',
    },
    {
      action: 'Pay the sample invoice with the test card `4242 4242 4242 4242`.',
      target: { kind: 'url', value: 'http://localhost:5173/billing/invoices' },
      expect: 'The invoice turns **Paid** within a few seconds.',
    },
    {
      action: 'Open the invoice in the dashboard.',
      target: { kind: 'screen', value: 'Billing → Invoices → the newest invoice' },
      expect: 'Its history lists `invoice.paid` with the time it arrived.',
    },
    {
      action: 'Read where the event is recorded.',
      target: { kind: 'file', value: 'apps/api/src/webhooks/stripe.ts:24-41' },
      expect: 'One write per event id, so a replayed event changes nothing.',
    },
  ],
};

function createReport(): PhaseReport {
  return {
    index: 0,
    summary: 'Records Stripe invoices from the webhook.',
    spots: [],
    judgementCalls: [],
    walkthrough: {
      approach: 'Verify the signature, then record the invoice.',
      flow: 'webhook → verify → record',
      risks: [],
      testing: TESTING,
      steps: STEPS,
    },
    at: 0,
  };
}

function createPullRequest(state: PullRequest['state']): PullRequest {
  return {
    number: 4721,
    url: 'https://github.com/superwall/paywall-next/pull/4721',
    state,
    checks: 'passing',
    unresolvedComments: 0,
    mergeable: state === 'open',
    updatedAt: 0,
  };
}

export function createMergeStepTasks(now: number): { gate: Task; merged: Task } {
  const base = {
    title: 'Record Stripe invoices from the webhook',
    repoId: 'repo-paywall',
    phaseReports: [createReport()],
  };
  return {
    gate: createSampleTask(now, {
      ...base,
      id: 'merge-steps-gate',
      stage: 'awaiting_merge',
      stageReason: 'pull request is clean',
      pullRequest: createPullRequest('open'),
    }),
    merged: createSampleTask(now, {
      ...base,
      id: 'merge-steps-merged',
      stage: 'merged',
      stageReason: 'pull request merged',
      stageChangedAt: now - 20 * 60_000,
      pullRequest: createPullRequest('merged'),
      mergeStepsDone: STEPS.slice(0, 3).map(resolveMergeStepKey),
    }),
  };
}

export const PARTIAL_COVERAGE: MeasuredCoverage = {
  status: 'measured',
  command: 'bun test --coverage --coverage-reporter=lcov',
  covered: 47,
  executable: 55,
  files: [
    {
      path: 'src/webhooks/stripe.ts',
      covered: 21,
      executable: 26,
      uncovered: [
        [48, 50],
        [77, 78],
      ],
    },
    { path: 'src/billing/payments.ts', covered: 8, executable: 11, uncovered: [[31, 33]] },
    { path: 'src/webhooks/verify.ts', covered: 18, executable: 18, uncovered: [] },
  ],
};

export const FULL_COVERAGE: MeasuredCoverage = {
  status: 'measured',
  command: 'bun test --coverage --coverage-reporter=lcov',
  covered: 18,
  executable: 18,
  files: [{ path: 'src/webhooks/verify.ts', covered: 18, executable: 18, uncovered: [] }],
};
