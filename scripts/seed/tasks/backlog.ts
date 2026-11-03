import type { SeedTask } from '../kit.ts';
import type { SeedRepos } from '../workspace.ts';

export function listBacklogTasks({ paywall, docs }: SeedRepos): SeedTask[] {
  return [
    {
      id: 'task-webhook-docs',
      request: 'Document signed webhooks and the export retry rules in the integration guide.',
      title: 'Document signed webhooks and export retries',
      repo: docs,
      size: 'small',
      priority: 'low',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Sign outgoing webhooks”, “Retry ClickHouse exports that time out” to finish',
      branch: 'docs/webhooks-and-export-retries',
      ageHours: 0.35,
      waitsOn: ['task-webhook-signing', 'task-export-retry'],
    },
    {
      id: 'task-retire-old-editor',
      request: 'Retire the old editor route once the banner has pointed people to the new one.',
      title: 'Retire the old editor route',
      repo: paywall,
      size: 'small',
      stage: 'waiting_on_tasks',
      reason:
        'waiting for “Banner for the old editor”, “Move through the paywall gallery with arrow keys” to finish',
      branch: 'chore/retire-old-editor',
      ageHours: 0.7,
      waitsOn: ['task-old-banner', 'task-gallery-shortcuts'],
      gate: {
        type: 'failure',
        title: '“Banner for the old editor” was cancelled',
        body: 'This task was waiting for it to finish. Retry to keep waiting on “Move through the paywall gallery with arrow keys” only, wait for another task instead, or cancel this one.',
      },
    },
    {
      id: 'task-gallery-shortcuts',
      request: 'Arrow keys should move between paywalls in the gallery.',
      title: 'Move through the paywall gallery with arrow keys',
      repo: paywall,
      size: 'small',
      priority: 'low',
      stage: 'planning',
      reason: 'planning the phases',
      branch: 'feat/gallery-arrow-keys',
      ageHours: 0.8,
      runs: [{ role: 'agent', purpose: 'plan', minutes: 0, summary: '' }],
    },
    {
      id: 'task-webhook-signing',
      request: 'Sign outgoing webhooks so customers can verify them.',
      title: 'Sign outgoing webhooks',
      repo: paywall,
      size: 'small',
      priority: 'high',
      stage: 'planning',
      reason: 'planning the phases',
      branch: 'feat/webhook-signing',
      ageHours: 0.4,
      runs: [{ role: 'agent', purpose: 'plan', minutes: 0, summary: '' }],
    },
  ];
}
