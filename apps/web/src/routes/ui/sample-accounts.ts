import type {
  AccountSummary,
  AccountsSnapshot,
  AccountUsage,
  ProviderLogin,
  UsageWindow,
} from '@shinsa/core';
import { HOUR, MINUTE } from './samples.ts';

function createSampleWindow(
  now: number,
  overrides: Partial<UsageWindow> & { id: string; usedPercent: number }
): UsageWindow {
  return {
    kind: 'session',
    label: '5-hour limit',
    model: null,
    resetsAt: now + 3 * HOUR,
    ...overrides,
  };
}

function createSampleAccount(
  now: number,
  overrides: Partial<AccountSummary> & {
    id: string;
    email: string;
    usedPercent: number;
    weeklyPercent?: number;
    extras?: Pick<AccountUsage, 'extraUsage' | 'resetGrants'>;
  }
): AccountSummary {
  const { usedPercent, weeklyPercent = usedPercent / 2, extras, ...account } = overrides;
  return {
    organization: null,
    plan: 'max',
    origin: 'login',
    isDefault: false,
    paused: false,
    switchAt: null,
    signIn: 'signed_in',
    signInDetail: null,
    usage: {
      status: 'ok',
      windows: [
        createSampleWindow(now, { id: `${overrides.id}-session`, usedPercent }),
        createSampleWindow(now, {
          id: `${overrides.id}-weekly`,
          kind: 'weekly',
          label: 'Weekly · All models',
          usedPercent: weeklyPercent,
          resetsAt: now + 4 * 24 * HOUR,
        }),
      ],
      detail: null,
      checkedAt: now - 2 * MINUTE,
      source: 'read',
      ...extras,
    },
    spentUntil: null,
    runs: 0,
    ...account,
  };
}

export function createSampleAccounts(now: number): AccountsSnapshot {
  return {
    accounts: [
      createSampleAccount(now, {
        id: 'work',
        email: 'christo@superwall.com',
        usedPercent: 42,
        isDefault: true,
        extras: {
          extraUsage: {
            enabled: true,
            noLimit: false,
            credit: { minor: 1240, exponent: 2, currency: 'USD' },
          },
          resetGrants: [
            {
              id: 'full-reset-2611',
              label: 'One full limit reset (November 2026)',
              left: 1,
              total: 1,
              clears: ['seven_day', 'seven_day_overage_included'],
              usableNow: true,
              endsAt: now + 2 * 24 * HOUR + 3 * HOUR,
              givesBackWeekly: false,
              weeklyShare: null,
            },
            {
              id: 'weekly-reset-2612',
              label: null,
              left: 1,
              total: 1,
              clears: ['seven_day'],
              usableNow: true,
              endsAt: now + 27 * 24 * HOUR,
              givesBackWeekly: false,
              weeklyShare: null,
            },
            {
              id: 'launch-2610-fable-6mo',
              label: 'New model launch: one more Fable reset at 6 months’ tenure',
              left: 1,
              total: 1,
              clears: ['seven_day_overage_included'],
              usableNow: true,
              endsAt: now + 118 * 24 * HOUR,
              givesBackWeekly: true,
              weeklyShare: 4,
            },
          ],
        },
      }),
      createSampleAccount(now, {
        id: 'side',
        email: 'christo@example.com',
        usedPercent: 81,
        extras: { extraUsage: { enabled: false, noLimit: false, credit: null } },
      }),
      createSampleAccount(now, {
        id: 'team',
        email: 'agents@superwall.com',
        usedPercent: 100,
        spentUntil: now + 2 * HOUR,
      }),
      createSampleAccount(now, {
        id: 'weekly',
        email: 'weekly@example.com',
        usedPercent: 0,
        weeklyPercent: 92,
      }),
      createSampleAccount(now, { id: 'old', email: 'old@example.com', usedPercent: 12, paused: true }),
      createSampleAccount(now, {
        id: 'lapsed',
        email: 'lapsed@example.com',
        usedPercent: 0,
        signIn: 'signed_out',
      }),
    ],
    login: null,
    imports: [],
    duplicates: [{ id: 'copy', email: 'christo@example.com', keptId: 'side' }],
    providers: [createSampleProviderLogins(now)[0] as ProviderLogin],
  };
}

export function createSampleProviderLogins(now = Date.now()): ProviderLogin[] {
  const codex = {
    provider: 'codex',
    label: 'Codex',
    method: null,
    version: '0.153.4',
    detail: null,
    fix: null,
  };
  return [
    {
      ...codex,
      status: 'signed_in',
      method: 'ChatGPT',
      detail: 'Signed in with ChatGPT.',
      email: 'christo@openai.example',
      plan: 'pro',
      usage: {
        status: 'ok',
        windows: [
          {
            id: 'five_hour',
            kind: 'session',
            label: '5-hour limit',
            model: null,
            usedPercent: 18,
            resetsAt: now + 3 * HOUR,
          },
          {
            id: 'seven_day',
            kind: 'weekly',
            label: 'Weekly limit',
            model: null,
            usedPercent: 57,
            resetsAt: now + 4 * 24 * HOUR,
          },
        ],
        detail: null,
        checkedAt: now - 2 * MINUTE,
        source: 'read',
        fastMode: 'needs_credits',
      },
    },
    {
      ...codex,
      status: 'signed_out',
      detail: 'Not logged in',
      fix: 'Run `codex login` in a terminal, then refresh.',
    },
    {
      ...codex,
      status: 'not_installed',
      version: null,
      detail: 'Codex is not installed.',
      fix: 'Install it with `npm install -g @openai/codex`.',
    },
    {
      ...codex,
      status: 'outdated',
      version: '0.120.0',
      detail:
        'Codex 0.120.0 is older than Shinsa needs (0.153.0 or newer). Update it from Settings → General, or run `codex update`.',
    },
  ];
}
