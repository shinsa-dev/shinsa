import { createPlanCheck, type SeedTask } from '../kit.ts';
import { USAGE_NEW, DEFAULTS_NEW, DEFAULTS_TEST_NEW } from '../sources/kanna.ts';
import { spot, rangeOf, lineOf } from '../spots.ts';
import type { SeedRepos, SeedWorktrees } from '../workspace.ts';

export function listPersonalTasks(
  { paywall, kanna, prints }: SeedRepos,
  worktrees: SeedWorktrees
): SeedTask[] {
  const defaultsPath = worktrees.defaults;
  const defaultsFile = 'src/shared/defaults.ts';
  const defaultsTestFile = 'src/shared/defaults.test.ts';
  const usageFile = 'src/shared/usage.ts';
  return [
    {
      id: 'task-usage-defaults',
      request: 'pick a cheaper default model when the usage window is almost used up',
      title: 'Fall back to a cheaper model near the usage limit',
      repo: kanna,
      size: 'small',
      priority: 'low',
      stage: 'awaiting_review',
      reason: 'built, checked and ready for review',
      branch: 'feat/usage-aware-defaults',
      ageHours: 70,
      extra: [{ type: 'task.snooze_changed', taskId: 'task-usage-defaults', snoozed: true }],
      verification: [createPlanCheck('Model defaults', 'bun test src/shared/defaults.test.ts', [1, 2, 3])],
      worktreePath: defaultsPath,
      report: {
        headline: 'New chats default to a cheaper model once 85% of the usage window is spent.',
        sections: [
          {
            title: 'Read the usage window',
            summary: 'A UsageWindow type carries how much is used, the limit and when it resets.',
            spots: [
              spot(usageFile, USAGE_NEW, 'export interface UsageWindow', 'resetsAt: number;', 'normal', {
                title: 'The usage window',
                why: 'Claude reports tokens and Codex reports requests; the ratio only holds when `used` and `limit` come from the same report.',
                explain:
                  'The shape both providers’ usage reports are mapped into. `resetsAt` is a timestamp in milliseconds; nothing in this change reads it yet.',
              }),
            ],
          },
          {
            title: 'Choose the model from usage',
            summary: 'resolveDefaultModel takes the usage window and falls back above 85%.',
            spots: [
              spot(
                defaultsFile,
                DEFAULTS_NEW,
                'export function resolveDefaultModel',
                'return resolveFallbackModel(provider);',
                'high',
                {
                  title: 'Fall back past the threshold',
                  why: 'A missing usage window keeps the preferred model, so accounts without usage data never fall back.',
                  explain:
                    'The preferred model stays unless there is a window and its used share has reached `FALLBACK_THRESHOLD`. The comparison is a ratio, so it works for any unit as long as both sides share it.',
                }
              ),
              spot(
                defaultsFile,
                DEFAULTS_NEW,
                'function resolveFallbackModel',
                "return 'gpt-6-mini';",
                'normal',
                {
                  title: 'One cheaper model per provider',
                  why: 'A new provider makes this switch fail to type-check until it gets a fallback, which is intended.',
                  explain:
                    'Each provider has one fallback: Sonnet for Claude and the mini model for Codex. The switch is exhaustive over `Provider`.',
                }
              ),
            ],
          },
          {
            title: 'Test the threshold',
            summary: 'Three tests around 85% and the missing window.',
            spots: [
              spot(
                defaultsTestFile,
                DEFAULTS_TEST_NEW,
                "it('falls back at 85% of the window'",
                "toBe('gpt-6-mini');",
                'normal',
                {
                  title: 'The boundary itself',
                  why: 'Exactly 85% falls back; the comparison is `<`, so the threshold is inclusive.',
                  explain: 'Checks both providers at exactly 85 of 100, where the fallback starts.',
                }
              ),
              spot(
                defaultsTestFile,
                DEFAULTS_TEST_NEW,
                "it('keeps the preferred model without usage data'",
                "expect(resolveDefaultModel('claude', null))",
                'normal',
                {
                  title: 'No usage data',
                  why: 'Covers `null`, not a window with a limit of 0.',
                  explain: 'An account whose provider reports no usage keeps the preferred model.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'Fall back at 85%',
            call: 'Threshold at 85%',
            reason: 'Leaves room to finish a long turn on the preferred model.',
            file: defaultsFile,
            ...rangeOf(DEFAULTS_NEW, 'const FALLBACK_THRESHOLD', 'const FALLBACK_THRESHOLD'),
            alternatives: [
              {
                option: '95%',
                rejected:
                  'A long agent turn started at 94% can use the rest of the window and stop halfway through an edit.',
              },
              {
                option: 'A setting for the threshold',
                rejected:
                  'One more setting for a number few people would change; it can become one if someone asks.',
              },
            ],
          },
          {
            title: 'Only new chats switch model',
            call: 'Only new chats change model',
            reason:
              'Switching a running chat mid-conversation drops the provider’s prompt cache and changes its behaviour halfway through a task.',
            file: defaultsFile,
            ...rangeOf(
              DEFAULTS_NEW,
              'export function resolveDefaultModel',
              'const preferred = resolvePreferredModel'
            ),
            alternatives: [
              {
                option: 'Switch running chats too',
                rejected:
                  'Saves more of the window, but the next turn reruns the whole context uncached on a model that did not start the work.',
              },
            ],
          },
          {
            title: 'A fixed fallback per provider',
            call: 'A fixed fallback per provider in code',
            reason: 'Each provider has exactly one cheaper model that handles agent work well enough.',
            file: defaultsFile,
            ...rangeOf(DEFAULTS_NEW, 'function resolveFallbackModel', "return 'gpt-6-mini';"),
            alternatives: [
              {
                option: 'Let you pick the fallback in settings',
                rejected: 'A picker for a list of one per provider; worth it once there is a real choice.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'Kanna picks a default model when a chat starts. `resolveDefaultModel` now also takes the provider’s current usage window: below 85% it returns the preferred model as before, at 85% or more it returns that provider’s cheaper model.\n\nThe usage window is a small new type in `usage.ts`, filled by the provider adapters. The model choice stays in `defaults.ts` as two switches, one for the preferred model and one for the fallback.',
          flow: '1. Starting a chat calls `resolveDefaultModel(provider, usage)` with the latest window, or `null` when the provider reports none.\n2. With no window, the preferred model is returned.\n3. Otherwise `used / limit` is compared with `FALLBACK_THRESHOLD` (0.85).\n4. Below it, the preferred model; at or above it, `resolveFallbackModel`.\n5. A running chat keeps its model; only the next new chat sees the change.\n\n```text\nnew chat ──▶ resolveDefaultModel(provider, usage)\n             │\n             ├─ no usage window ─────▶ the preferred model\n             │\n             ├─ used / limit < 0.85 ─▶ the preferred model\n             │\n             └─ used / limit ≥ 0.85 ─▶ resolveFallbackModel\n                                       sonnet for Claude, mini for Codex\n\nrunning chat ──▶ keeps its model; only the next new chat changes\n```',
          risks: [
            {
              title: 'A zero limit divides by zero',
              risk: 'A window with a limit of 0 divides by zero: `0 / 0` is `NaN`, which fails the `<` check, so the fallback is picked for an account with no limit at all.',
              file: defaultsFile,
              ...rangeOf(
                DEFAULTS_NEW,
                'if (!usage || usage.used / usage.limit',
                'if (!usage || usage.used / usage.limit'
              ),
            },
            {
              title: 'Imminent resets are ignored',
              risk: 'The choice ignores `resetsAt`: a window at 90% that resets in two minutes still starts the chat on the cheaper model.',
              file: usageFile,
              ...rangeOf(USAGE_NEW, 'resetsAt: number;', 'resetsAt: number;'),
            },
            {
              title: 'No usage, no fallback',
              risk: 'Accounts whose provider reports no usage never fall back, however close they are to the limit.',
              file: defaultsFile,
              ...rangeOf(
                DEFAULTS_NEW,
                'if (!usage || usage.used / usage.limit',
                'if (!usage || usage.used / usage.limit'
              ),
            },
          ],
          testing: {
            automated: [
              '`defaults.test.ts` covers 84% (preferred), exactly 85% for both providers (fallback) and no usage data (preferred).',
            ],
            manual: [
              {
                action:
                  'Start Kanna from the worktree with a Claude account whose usage window is above 85%.',
                target: { kind: 'command', value: 'bun run dev' },
                expect: 'The client serves on port 5174 and the usage meter shows the window above 85%.',
              },
              {
                action: 'Start a new chat.',
                target: { kind: 'url', value: 'http://localhost:5174/' },
                expect: 'The model picker shows Sonnet instead of Opus.',
              },
              {
                action: 'Go back to a chat that was already open before the window passed 85%.',
                target: null,
                expect: 'It keeps Opus; only new chats change.',
              },
              {
                action: 'Switch to an account whose provider reports no usage and start a chat.',
                target: null,
                expect: 'The preferred model, however much of the window is used.',
              },
              {
                action: 'Read the threshold check, including what a limit of 0 does.',
                target: {
                  kind: 'file',
                  value: `${defaultsFile}:${lineOf(DEFAULTS_NEW, 'if (!usage || usage.used / usage.limit')}`,
                },
                expect: 'A limit of 0 gives `NaN` and falls back, the first risk above.',
              },
            ],
          },
        },
      },
      provider: 'codex',
      runs: [{ role: 'agent', purpose: 'build', minutes: 11, summary: 'Added the fallback.' }],
      gate: { type: 'review', title: 'Review the usage-aware defaults', body: 'Ready for review.' },
    },
    {
      id: 'task-dark-contrast',
      request: 'settings dark mode contrast is too low',
      title: 'Raise contrast in dark settings',
      repo: kanna,
      size: 'small',
      stage: 'merged',
      reason: 'merged',
      branch: 'fix/dark-settings-contrast',
      ageHours: 96,
      pullRequest: { number: 212, checks: 'passing' },
      merged: true,
      ticked: ['Update the dark mode screenshots in the help center'],
      report: {
        headline: 'Hint text, borders and disabled labels read clearly in dark settings.',
        sections: [
          {
            title: 'Raise the muted tokens in dark mode',
            summary:
              'The dark theme’s muted text and border tokens move up so hint text passes 4.5:1 on the panel. Light mode keeps its values.',
            spots: [],
          },
          {
            title: 'Raise the disabled labels',
            summary: 'Disabled rows use a lighter grey in dark mode: dimmer than the rest, but readable.',
            spots: [],
          },
        ],
        judgementCalls: [],
        walkthrough: {
          approach:
            'Only the dark theme’s tokens change, so every screen that reads them improves at once and light mode is untouched.',
          flow: 'The settings page reads `--muted`, `--border` and `--disabled` from the theme; nothing else changes.',
          risks: [],
          testing: {
            automated: ['No new tests: the change is three colour tokens in the dark theme.'],
            manual: [
              {
                action: 'Open Appearance in dark mode.',
                target: { kind: 'screen', value: 'Settings → Appearance' },
                expect:
                  'The hint under each setting reads at a glance, and disabled rows are dimmer but readable.',
              },
              {
                action: 'Switch to light mode on the same screen.',
                target: null,
                expect: 'Nothing moves or changes colour.',
              },
              {
                action: 'Read the dark theme block to see which tokens moved.',
                target: { kind: 'file', value: 'src/client/theme.css' },
                expect: 'Only `--muted`, `--border` and `--disabled` change, and only under the dark theme.',
              },
            ],
          },
          steps: [
            {
              when: 'post_merge',
              kind: 'deploy',
              title: 'Purge the CDN cache for the settings stylesheet',
              detail:
                'Cloudflare keeps `settings.css` for a day, so dark mode shows the old contrast until it is purged. The token is in 1Password under Cloudflare.',
              command:
                'curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" -H "Authorization: Bearer $CF_API_TOKEN" --data \'{"files":["https://app.superwall.com/assets/settings.css"]}\'',
            },
            {
              when: 'post_merge',
              kind: 'other',
              title: 'Update the dark mode screenshots in the help center',
              detail:
                'The Appearance article shows the old greys. Take them in Settings → Appearance at 1280 wide.',
              command: null,
            },
          ],
        },
      },
      runs: [
        {
          role: 'agent',
          purpose: 'build',
          minutes: 6,
          summary: 'Raised the muted text and border tokens in dark mode.',
        },
        { role: 'reviewer', minutes: 2, summary: 'No findings.' },
        { role: 'agent', purpose: 'fix', fix: 'you', minutes: 3, summary: 'Raised the disabled text too.' },
      ],
      revision: {
        afterRun: 1,
        response: 'The disabled labels are still too faint. Raise them with the rest.',
      },
    },
    {
      id: 'task-print-retries',
      request: 'print jobs should retry when the printer is offline',
      title: 'Retry print jobs when the printer is offline',
      repo: prints,
      size: 'large',
      planFirst: true,
      stage: 'planning',
      reason: 'writing the plan',
      branch: 'feat/print-retries',
      ageHours: 0.3,
      runs: [{ role: 'agent', purpose: 'plan', minutes: 0, summary: '' }],
    },
    {
      id: 'task-old-banner',
      request: 'add a banner for the old editor',
      title: 'Banner for the old editor',
      repo: paywall,
      size: 'small',
      stage: 'cancelled',
      reason: 'cancelled',
      branch: 'feat/old-editor-banner',
      ageHours: 120,
    },
    {
      id: 'task-duplicate-currency',
      request: 'paywall should show euros for german users, not dollars',
      title: 'Show euro prices on the paywall in Germany',
      repo: paywall,
      size: 'small',
      stage: 'cancelled',
      reason: 'duplicate of “Show paywall prices in the visitor’s currency”',
      branch: 'fix/paywall-euro-prices',
      ageHours: 1,
      extra: [
        {
          type: 'task.duplicated',
          taskId: 'task-duplicate-currency',
          duplicate: {
            of: 'task-paywall-euro-prices',
            by: 'shinsa',
            why: 'Both show paywall prices in the store’s currency for the visitor’s region.',
          },
        },
      ],
    },
    {
      id: 'task-duplicate-teammate',
      request: 'let people pick a dark theme for the paywall editor',
      title: 'Add a dark theme to the paywall editor',
      repo: paywall,
      size: 'small',
      stage: 'cancelled',
      reason: 'duplicate of Kai’s KAI-12 “Add dark mode to the paywall editor”',
      branch: 'feat/editor-dark-theme',
      ageHours: 3,
      extra: [
        {
          type: 'task.duplicated',
          taskId: 'task-duplicate-teammate',
          duplicate: {
            of: 'kai-dark-mode',
            by: 'shinsa',
            why: 'Both add a dark theme to the paywall editor.',
            teammate: {
              teamId: 'core',
              machineId: 'kai',
              taskId: 'kai-dark-mode',
              handle: 'KAI-12',
              title: 'Add dark mode to the paywall editor',
              owner: { login: 'kai', name: 'Kai Tanaka', avatarUrl: null },
            },
          },
        },
      ],
    },
    {
      id: 'task-closed-spinner',
      request: 'let paywalls hide the native purchase spinner',
      title: 'Hide the native purchase spinner',
      repo: paywall,
      size: 'small',
      stage: 'cancelled',
      reason: 'pull request closed',
      branch: 'feat/hide-purchase-spinner',
      ageHours: 2,
      summary: 'Paywalls can hide the native purchase spinner and show their own loading state.',
      report: {
        headline: 'A paywall option hides the native purchase spinner.',
        sections: [
          {
            title: 'Document and test the option',
            summary: 'Documented the option and tested both values.',
            spots: [],
          },
          { title: 'Changelog and lint', summary: 'Added the changelog entry.', spots: [] },
        ],
        judgementCalls: [],
      },
      runs: [
        { role: 'agent', purpose: 'build', minutes: 9, summary: 'Documented and tested the option.' },
        { role: 'reviewer', minutes: 2, summary: 'No findings.' },
      ],
      pullRequest: { number: 4575, checks: 'passing' },
      extra: [
        {
          type: 'task.staged',
          taskId: 'task-closed-spinner',
          stage: 'awaiting_merge',
          reason: 'ready to merge',
        },
      ],
    },
    {
      id: 'task-cancelled-export',
      request: 'export paywall analytics as CSV',
      title: 'Export paywall analytics as CSV',
      repo: paywall,
      size: 'large',
      stage: 'cancelled',
      reason: 'cancelled by you',
      branch: 'feat/analytics-csv-export',
      ageHours: 3,
      runs: [{ role: 'agent', purpose: 'build', minutes: 6, summary: 'Built the first phase.' }],
      extra: [
        { type: 'phase.updated', taskId: 'task-cancelled-export', index: 0, status: 'done' },
        { type: 'task.staged', taskId: 'task-cancelled-export', stage: 'building', reason: 'building' },
      ],
    },
  ];
}
