import type { ShinsaEventInput } from '../../../packages/core/src/index.ts';
import { createPlanCheck, listSeedIterations, type SeedTask } from '../kit.ts';
import type { SeedRepos } from '../workspace.ts';

function listKeyRotationIterations(): ShinsaEventInput[] {
  return listSeedIterations('task-key-rotation', 'task-key-rotation-run-0', [
    {
      text: 'Can customers choose how long the old key keeps working? 24 hours is short for some of our bigger accounts. And please put the pepper secret in the pre-merge steps.',
      reply: {
        headline: 'The overlap stays at 24 hours, and creating `API_KEY_PEPPER` is now a pre-merge step.',
        points: [
          {
            ask: 'Let customers choose the overlap',
            outcome: 'not_changed',
            note: 'A longer overlap keeps a leaked key alive longer. I suggested a follow-up task for a per-account overlap, so it gets its own review.',
          },
          {
            ask: 'Put the pepper secret in the pre-merge steps',
            outcome: 'done',
            note: 'Step 1 now creates `API_KEY_PEPPER` in production, with the exact command.',
          },
        ],
        next: 'Tick both pre-merge steps below once they are done in production, then merge [#4548](shinsa://pr/paywall-next#4548).',
      },
    },
  ]);
}

export function listMergeStepTasks({ paywall, kanna }: Pick<SeedRepos, 'paywall' | 'kanna'>): SeedTask[] {
  return [
    {
      id: 'task-key-rotation',
      request: 'let customers rotate their API key without downtime',
      title: 'Rotate API keys without downtime',
      repo: paywall,
      size: 'large',
      stage: 'awaiting_merge',
      reason: 'ready to merge',
      branch: 'feat/api-key-rotation',
      ageHours: 7,
      verification: [createPlanCheck('Both keys during the overlap', 'bun test src/api/keys', [1, 2, 3, 4])],
      checkResults: {
        r1: {
          outcome: 'fail',
          detail: 'src/legacy/banner.ts: 2 errors. The same command fails on main.',
          note: 'fails_on_base',
        },
      },
      summary: 'A rotated API key keeps working for 24 hours next to the new one.',
      report: {
        headline:
          'Rotating an API key keeps the old one working for 24 hours, so customers swap it without downtime.',
        sections: [
          {
            title: 'Accept the previous key for a day',
            summary:
              'The key check accepts the current key or, until it expires, the previous one, hashed with the same pepper.',
            spots: [],
          },
          {
            title: 'Rotate from the dashboard',
            summary:
              'Settings → API keys has Rotate, which shows the new key once and when the old one stops working.',
            spots: [],
          },
        ],
        judgementCalls: [],
        walkthrough: {
          approach:
            'The previous key is kept as a hash with an expiry next to the current one, so the one key check covers every route.',
          flow: '1. Rotate stores the current hash as the previous one with a 24 hour expiry.\n2. A request’s key is checked against the current hash, then the previous one while it lasts.\n3. After the expiry the previous hash is cleared on the next check.',
          risks: [],
          testing: {
            automated: [
              '`api-keys/rotate.test.ts` covers both keys working after a rotation and the old one failing after 24 hours.',
            ],
            manual: [
              {
                action: 'Rotate the key from the dashboard.',
                target: { kind: 'url', value: 'http://localhost:5173/settings/api-keys' },
                expect: 'The new key shows once, with “The old key works until …” under it.',
              },
              {
                action: 'Call the API with the old key.',
                target: {
                  kind: 'command',
                  value: 'curl -H "Authorization: Bearer $OLD_KEY" http://localhost:8787/v1/paywalls',
                },
                expect: 'It returns 200; with a made-up key it returns 401.',
              },
            ],
          },
          steps: [
            {
              when: 'pre_merge',
              kind: 'secret',
              title: 'Create `API_KEY_PEPPER` in production',
              detail:
                'Both hashes use it. Generate 32 random bytes and add it to the API service in Railway; never reuse staging’s.',
              command:
                'railway variables --service api --environment production --set API_KEY_PEPPER=$(openssl rand -hex 32)',
            },
            {
              when: 'pre_merge',
              kind: 'migration',
              title: 'Run the `api_keys_previous` migration',
              detail:
                'It adds the previous hash and its expiry. It is additive, so it is safe before the code ships.',
              command: 'bun run --cwd apps/api db:migrate',
            },
            {
              when: 'post_merge',
              kind: 'other',
              title: 'Announce key rotation in the changelog',
              detail: 'Link the API keys guide so customers know the old key keeps working for a day.',
              command: null,
            },
          ],
        },
      },
      runs: [
        {
          role: 'agent',
          purpose: 'build',
          minutes: 12,
          summary: 'Kept the previous key for a day.',
        },
        { role: 'reviewer', minutes: 3, summary: 'No findings.' },
      ],
      pullRequest: { number: 4548, checks: 'passing' },
      ticked: ['Create `API_KEY_PEPPER` in production', 'Run the `api_keys_previous` migration'],
      extra: listKeyRotationIterations(),
      gate: {
        type: 'merge',
        title: 'Merge #4548',
        body: 'Checks are green and both pre-merge steps are ticked.',
      },
    },
    {
      id: 'task-session-timeout',
      request: 'log people out after 12 hours idle',
      title: 'Log out after 12 idle hours',
      repo: kanna,
      size: 'small',
      stage: 'merged',
      reason: 'merged',
      branch: 'feat/idle-timeout',
      ageHours: 30,
      pullRequest: { number: 219, checks: 'passing', mergeCommit: '4be1a07' },
      merged: true,
      summary: 'Sessions end after 12 hours without activity.',
      report: {
        headline: 'Sessions end after 12 hours without activity, configurable per workspace.',
        sections: [
          {
            title: 'Expire idle sessions',
            summary:
              'The session store records the last request and refuses a session idle for longer than the limit.',
            spots: [],
          },
        ],
        judgementCalls: [],
        walkthrough: {
          approach: 'The limit lives in the session store, so every route is covered by one check.',
          flow: 'Each request touches the session; a session idle past `SESSION_IDLE_HOURS` is refused and the user signs in again.',
          risks: [],
          testing: {
            automated: ['`session-store.test.ts` covers the idle limit and the default of 12 hours.'],
            manual: [
              {
                action: 'Start the app with a one-minute limit and wait a minute.',
                target: { kind: 'command', value: 'SESSION_IDLE_HOURS=0.0167 bun run dev' },
                expect: 'The next click lands on the sign-in page.',
              },
            ],
          },
          steps: [
            {
              when: 'post_merge',
              kind: 'env',
              title: 'Set `SESSION_IDLE_HOURS=12` in production',
              detail: 'The default is 12 already; setting it makes the value visible to on-call.',
              command: 'fly secrets set SESSION_IDLE_HOURS=12 --app kanna',
            },
            {
              when: 'post_merge',
              kind: 'deploy',
              title: 'Restart the web workers',
              detail: 'Workers read the variable on start.',
              command: 'fly apps restart kanna',
            },
          ],
        },
      },
      runs: [
        { role: 'agent', purpose: 'build', minutes: 5, summary: 'Added the idle limit.' },
        { role: 'reviewer', minutes: 2, summary: 'No findings.' },
      ],
      ticked: ['Set `SESSION_IDLE_HOURS=12` in production', 'Restart the web workers'],
    },
  ];
}
