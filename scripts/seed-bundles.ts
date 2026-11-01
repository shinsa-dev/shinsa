import type { Repo, ShinsaEventInput } from '../packages/core/src/index.ts';
import type { SeedTask } from './seed-kit.ts';

function stack(taskId: string, stacksOn: string, base: string | null): ShinsaEventInput[] {
  return [
    { type: 'task.stack_changed', taskId, stacksOn, by: 'you' },
    ...(base ? [{ type: 'task.stack_based' as const, taskId, base }] : []),
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
  ];
}
