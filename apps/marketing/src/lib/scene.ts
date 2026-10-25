import type { Gate, PlanDocument, Project, PullRequest, Repo, ShinsaState, Task } from '@shinsa/core';
import {
  createSampleGate,
  createSampleRun,
  createSampleState,
  createSampleTask,
  HOUR,
  MINUTE,
} from '@/routes/ui/samples.ts';

export const PROJECT: Project = {
  id: 'northwind',
  name: 'Northwind',
  color: 'blue',
  key: 'NW',
  description: 'The Northwind store: the web app, the API and the iOS app.',
  folders: ['~/Developer/northwind'],
};

const REPOS: Repo[] = [
  {
    id: 'web',
    name: 'northwind-web',
    path: '~/Developer/northwind/web',
    defaultBranch: 'main',
    remote: 'github.com/northwind/web',
    projectId: PROJECT.id,
    checkCommands: ['bun lint', 'bun check-types', 'bun run test'],
  },
  {
    id: 'api',
    name: 'northwind-api',
    path: '~/Developer/northwind/api',
    defaultBranch: 'main',
    remote: 'github.com/northwind/api',
    projectId: PROJECT.id,
    checkCommands: ['bun lint', 'bun run test'],
  },
  {
    id: 'ios',
    name: 'northwind-ios',
    path: '~/Developer/northwind/ios',
    defaultBranch: 'main',
    remote: 'github.com/northwind/ios',
    projectId: PROJECT.id,
    checkCommands: ['xcodebuild test -scheme Northwind'],
  },
];

const CHANGE_PIPELINE: Task['pipeline'] = [
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
];

export function createPullRequest(now: number, number: number, overrides: Partial<PullRequest> = {}) {
  return {
    number,
    url: `https://github.com/northwind/web/pull/${number}`,
    state: 'open' as const,
    checks: 'passing' as const,
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: now - 4 * MINUTE,
    ...overrides,
  };
}

export const ONBOARDING_PLAN: PlanDocument = {
  goal: 'New stores set up in three short steps instead of one long form, and leaving halfway keeps what was entered.',
  phases: [
    {
      title: 'Split the form into steps',
      detail: 'Store details, then payments, then shipping. Each step has its own route.',
    },
    {
      title: 'Save each step as it is finished',
      detail: 'A draft store keeps the answers, so a reload lands on the next step.',
    },
    {
      title: 'Show progress at the top',
      detail: 'Three dots, the current one filled, with a back link from step two on.',
    },
  ],
  behaviour: [],
  approach: '',
  files: [],
  outOfScope: [],
  verification: ['A test that a reload resumes on the next step', 'Screenshots of each step in both themes'],
  questions: [],
};

function task(now: number, overrides: Partial<Task> & { id: string; title: string; handle: string }) {
  return createSampleTask(now, {
    projectId: PROJECT.id,
    repoId: 'web',
    pipeline: CHANGE_PIPELINE,
    ...overrides,
  });
}

export function createHomeScene(now: number): ShinsaState {
  const tasks: Task[] = [
    task(now, {
      id: 'apple-pay',
      handle: 'NW-148',
      title: 'Add Apple Pay to checkout',
      stage: 'awaiting_merge',
      stageReason: 'ready to merge',
      branch: 'feat/apple-pay',
      pullRequest: createPullRequest(now, 812),
      stageChangedAt: now - 6 * MINUTE,
    }),
    task(now, {
      id: 'webhooks',
      handle: 'NW-151',
      title: 'Retry failed webhook deliveries',
      repoId: 'api',
      stage: 'awaiting_review',
      stageReason: 'changes to review',
      branch: 'feat/webhook-retries',
      stageChangedAt: now - 14 * MINUTE,
    }),
    task(now, {
      id: 'v1-orders',
      handle: 'NW-153',
      title: 'Remove the v1 orders endpoint',
      repoId: 'api',
      stage: 'building',
      stageReason: 'needs your answer',
      stageChangedAt: now - 9 * MINUTE,
    }),
    task(now, {
      id: 'onboarding',
      handle: 'NW-155',
      title: 'Split store onboarding into steps',
      stage: 'awaiting_plan',
      stageReason: 'plan to approve',
      plan: { version: 1, body: '', document: ONBOARDING_PLAN, proposedAt: now - 3 * MINUTE },
      stageChangedAt: now - 3 * MINUTE,
    }),
    task(now, {
      id: 'order-stream',
      handle: 'NW-156',
      title: 'Stream order updates to the dashboard',
      stage: 'building',
      stageReason: 'building phase 2 of 3',
      phases: [
        { status: 'done', at: now - 40 * MINUTE },
        { status: 'active', at: now - 12 * MINUTE },
        { status: 'pending', at: now },
      ],
      stageChangedAt: now - 40 * MINUTE,
    }),
    task(now, {
      id: 'cart-badge',
      handle: 'NW-157',
      title: 'Fix the stale cart badge',
      repoId: 'ios',
      stage: 'fixing',
      stageReason: 'fixing a failing CI check',
      pullRequest: createPullRequest(now, 214, { checks: 'failing' }),
      stageChangedAt: now - 5 * MINUTE,
    }),
    task(now, {
      id: 'exports',
      handle: 'NW-158',
      title: 'Why do nightly exports stall?',
      repoId: 'api',
      stage: 'investigating',
      stageReason: 'reproducing the stall',
      pipeline: ['investigate'],
      stageChangedAt: now - 18 * MINUTE,
    }),
    task(now, {
      id: 'webhook-settings',
      handle: 'NW-159',
      title: 'Add a settings screen for webhooks',
      stage: 'waiting_on_tasks',
      stageReason: 'waiting on NW-151',
      waitsOn: ['webhooks'],
      stageChangedAt: now - 30 * MINUTE,
    }),
    task(now, {
      id: 'product-cache',
      handle: 'NW-146',
      title: 'Cache the product list',
      stage: 'merged',
      stageReason: 'merged',
      pullRequest: createPullRequest(now, 806, { state: 'merged' }),
      stageChangedAt: now - 2 * HOUR,
      updatedAt: now - 2 * HOUR,
    }),
    task(now, {
      id: 'tax-answer',
      handle: 'NW-145',
      title: 'Where is sales tax calculated?',
      repoId: 'api',
      stage: 'done',
      pipeline: ['answer'],
      result: {
        step: 'answer',
        body: 'In `pricing/tax.ts`, from the store’s region, after discounts and before shipping.',
        runId: null,
        at: now - 3 * HOUR,
      },
      stageChangedAt: now - 3 * HOUR,
      updatedAt: now - 3 * HOUR,
    }),
  ];
  const gates: Gate[] = [
    createSampleGate(now, {
      id: 'apple-pay-merge',
      taskId: 'apple-pay',
      type: 'merge',
      title: 'Merge the pull request',
      openedAt: now - 6 * MINUTE,
    }),
    createSampleGate(now, {
      id: 'webhooks-review',
      taskId: 'webhooks',
      type: 'review',
      title: 'Review the changes',
      openedAt: now - 14 * MINUTE,
    }),
    createSampleGate(now, {
      id: 'v1-orders-question',
      taskId: 'v1-orders',
      type: 'question',
      title: 'Keep the v1 endpoint for one more release?',
      body: 'The iOS app before 4.2 still calls `/v1/orders`, about 6% of last week’s orders.',
      choices: ['Keep v1 for one more release', 'Remove it now'],
      recommendation: 'Keep v1 for one more release',
      runId: 'v1-orders-run',
      openedAt: now - 9 * MINUTE,
    }),
    createSampleGate(now, {
      id: 'onboarding-plan',
      taskId: 'onboarding',
      type: 'plan',
      title: 'Approve the plan',
      planVersion: 1,
      openedAt: now - 3 * MINUTE,
    }),
  ];
  const state = createSampleState({
    tasks,
    gates,
    runs: [
      createSampleRun(now, { id: 'v1-orders-run', taskId: 'v1-orders' }),
      createSampleRun(now, { id: 'order-stream-run', taskId: 'order-stream', startedAt: now - 12 * MINUTE }),
      createSampleRun(now, {
        id: 'cart-badge-run',
        taskId: 'cart-badge',
        purpose: 'fix',
        startedAt: now - 5 * MINUTE,
      }),
      createSampleRun(now, { id: 'exports-run', taskId: 'exports', startedAt: now - 18 * MINUTE }),
    ],
  });
  return {
    ...state,
    projects: { [PROJECT.id]: PROJECT },
    repos: Object.fromEntries(REPOS.map((repo) => [repo.id, repo])),
    focus: { projectId: PROJECT.id, until: null },
    taskNumbers: { [PROJECT.key]: 159 },
    briefings: {
      [PROJECT.id]: {
        text: '',
        at: now - 2 * MINUTE,
        briefing: {
          now: {
            taskId: 'apple-pay',
            why: 'CI passed and both review bots are quiet. Merging it lets the checkout redesign start.',
          },
          next: [
            { taskId: 'v1-orders', why: 'One answer unblocks the agent.' },
            { taskId: 'webhooks', why: 'Small change, two files, evidence attached.' },
            { taskId: 'onboarding', why: 'Three phases, waiting for your go-ahead.' },
          ],
          running: 'Three agents are working: order updates, the cart badge and the export stall.',
          note: null,
        },
      },
    },
  };
}
