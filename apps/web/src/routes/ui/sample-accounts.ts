import type { AccountSummary, AccountsSnapshot, ProviderLogin, UsageWindow } from '@shinsa/core';
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
  overrides: Partial<AccountSummary> & { id: string; email: string; usedPercent: number }
): AccountSummary {
  const { usedPercent, ...account } = overrides;
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
          usedPercent: usedPercent / 2,
          resetsAt: now + 4 * 24 * HOUR,
        }),
      ],
      detail: null,
      checkedAt: now - 2 * MINUTE,
      source: 'read',
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
      }),
      createSampleAccount(now, { id: 'side', email: 'christo@example.com', usedPercent: 81 }),
      createSampleAccount(now, {
        id: 'team',
        email: 'agents@superwall.com',
        usedPercent: 100,
        spentUntil: now + 2 * HOUR,
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
        'Codex 0.120.0 is older than Shinsa needs (0.153.0 or newer). Update it from Settings → Agents, or run `codex update`.',
    },
  ];
}
