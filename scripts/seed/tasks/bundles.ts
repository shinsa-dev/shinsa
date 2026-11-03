import type { Repo, ShinsaEventInput } from '../../../packages/core/src/index.ts';
import type { SeedTask } from '../kit.ts';

function stack(
  taskId: string,
  stacksOn: string | string[],
  bases: string | string[] | null
): ShinsaEventInput[] {
  const parents = typeof stacksOn === 'string' ? [stacksOn] : stacksOn;
  const branches = typeof bases === 'string' ? [bases] : bases;
  return [
    { type: 'task.stack_changed', taskId, stacksOn: parents, by: 'you' },
    ...(branches ? [{ type: 'task.stack_based' as const, taskId, bases: branches }] : []),
  ];
}

function ready(taskId: string, commit: string): ShinsaEventInput {
  return { type: 'task.bundle_ready', taskId, ready: { commit } };
}

export function listBundleTasks({ paywall }: { paywall: Repo }): SeedTask[] {
  return [
    {
      id: 'task-bundle-schema',
      request: 'Add the schema for saved checkout carts: a carts table with its line items.',
      title: 'Add the saved cart schema',
      repo: paywall,
      size: 'small',
      stage: 'awaiting_merge',
      reason: 'pull request is clean',
      branch: 'feat/saved-cart-schema',
      ageHours: 9,
      summary: 'A carts table with its line items, and the migration that adds them.',
      pullRequest: { number: 4610, checks: 'passing' },
      extra: [ready('task-bundle-schema', '5e1c0a2')],
      gate: {
        type: 'merge',
        title: 'Merge “Add the saved cart schema”',
        body: 'Approving merges the whole bundle as one, from the last pull request back to this one: #4610 “Add the saved cart schema”, #4611 “Serve saved carts over the API”, #4612 “Restore saved carts at checkout”.\n\nA carts table with its line items, and the migration that adds them.',
      },
    },
    {
      id: 'task-bundle-api',
      request: 'Serve saved carts over the API: save, read and restore a cart.',
      title: 'Serve saved carts over the API',
      repo: paywall,
      size: 'small',
      stage: 'shipping',
      reason: 'ready, merges with its bundle',
      branch: 'feat/saved-cart-api',
      ageHours: 7,
      summary: 'Save, read and restore a cart, on the new carts table.',
      pullRequest: { number: 4611, checks: 'passing' },
      extra: [
        ...stack('task-bundle-api', 'task-bundle-schema', 'feat/saved-cart-schema'),
        ready('task-bundle-api', '9b7f311'),
      ],
    },
    {
      id: 'task-bundle-screen',
      request: 'Restore a saved cart from the checkout screen.',
      title: 'Restore saved carts at checkout',
      repo: paywall,
      size: 'small',
      stage: 'shipping',
      reason: 'ready, merges with its bundle',
      branch: 'feat/saved-cart-screen',
      ageHours: 5,
      summary: 'Checkout offers the saved cart and restores it in one click.',
      pullRequest: { number: 4612, checks: 'passing' },
      extra: [
        ...stack('task-bundle-screen', 'task-bundle-api', 'feat/saved-cart-api'),
        ready('task-bundle-screen', 'c41d9e0'),
      ],
    },
    {
      id: 'task-bundle-events',
      request: 'Record a paywall view event for every impression, with the placement it came from.',
      title: 'Record paywall view events',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'building phase 2 of 3',
      branch: 'feat/paywall-view-events',
      ageHours: 2,
    },
    {
      id: 'task-bundle-chart',
      request: 'Chart paywall views per placement on the dashboard, from the new view events.',
      title: 'Chart paywall views per placement',
      repo: paywall,
      size: 'small',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Record paywall view events” to be ready to merge',
      branch: 'feat/paywall-view-chart',
      ageHours: 1.5,
      extra: stack('task-bundle-chart', 'task-bundle-events', null),
    },
    {
      id: 'task-diamond-models',
      request: 'Add the subscription models the billing rework builds on: plans, prices and entitlements.',
      title: 'Add the subscription models',
      repo: paywall,
      size: 'small',
      stage: 'shipping',
      reason: 'ready, merges with its bundle',
      branch: 'feat/billing-models',
      ageHours: 12,
      summary: 'Plans, prices and entitlements as tables, with their migration.',
      pullRequest: { number: 4620, checks: 'passing' },
      extra: [ready('task-diamond-models', '1a2b3c4')],
    },
    {
      id: 'task-diamond-stripe',
      request: 'Sync the subscription models from Stripe on every webhook.',
      title: 'Sync plans from Stripe',
      repo: paywall,
      size: 'small',
      stage: 'shipping',
      reason: 'ready, merges with its bundle',
      branch: 'feat/billing-stripe-sync',
      ageHours: 11,
      pullRequest: { number: 4621, checks: 'passing' },
      extra: [
        ...stack('task-diamond-stripe', 'task-diamond-models', 'feat/billing-models'),
        ready('task-diamond-stripe', '2b3c4d5'),
      ],
    },
    {
      id: 'task-diamond-apple',
      request: 'Sync the subscription models from App Store Server Notifications.',
      title: 'Sync plans from the App Store',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'building phase 2 of 3',
      branch: 'feat/billing-apple-sync',
      ageHours: 10.5,
      extra: stack('task-diamond-apple', 'task-diamond-models', 'feat/billing-models'),
    },
    {
      id: 'task-diamond-google',
      request: 'Sync the subscription models from Google Play real-time notifications.',
      title: 'Sync plans from Google Play',
      repo: paywall,
      size: 'small',
      stage: 'shipping',
      reason: 'ready, merges with its bundle',
      branch: 'feat/billing-google-sync',
      ageHours: 10,
      pullRequest: { number: 4623, checks: 'passing' },
      extra: [
        ...stack('task-diamond-google', 'task-diamond-models', 'feat/billing-models'),
        ready('task-diamond-google', '4d5e6f7'),
      ],
    },
    {
      id: 'task-diamond-entitlements',
      request: 'Resolve a customer’s entitlements from every store in one place.',
      title: 'Resolve entitlements across stores',
      repo: paywall,
      size: 'small',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Sync plans from the App Store” to be ready to merge',
      branch: 'feat/billing-entitlements',
      ageHours: 9,
      extra: stack(
        'task-diamond-entitlements',
        ['task-diamond-stripe', 'task-diamond-apple', 'task-diamond-google'],
        null
      ),
    },
    {
      id: 'task-diamond-paywall',
      request: 'Gate paywall content on the resolved entitlements.',
      title: 'Gate paywalls on entitlements',
      repo: paywall,
      size: 'small',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Resolve entitlements across stores” to be ready to merge',
      branch: 'feat/billing-paywall-gate',
      ageHours: 8,
      extra: stack('task-diamond-paywall', 'task-diamond-entitlements', null),
    },
  ];
}
