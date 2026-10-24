import { describe, expect, test } from 'bun:test';
import { createAccountsSnapshot, createFakeClient, runSpec } from './fixtures.ts';

const SNAPSHOT = createAccountsSnapshot();

const RESET = Date.UTC(2026, 9, 23, 18);

const MIXED = createAccountsSnapshot({
  accounts: [
    ...SNAPSHOT.accounts,
    {
      ...SNAPSHOT.accounts[0],
      id: 'acc-2',
      email: null,
      plan: null,
      isDefault: false,
      paused: true,
      signIn: 'signed_out',
      usage: { windows: [], detail: null },
      spentUntil: RESET,
    },
    {
      ...SNAPSHOT.accounts[0],
      id: 'acc-3',
      email: 'other@example.com',
      isDefault: false,
      usage: {
        windows: [
          { label: 'Session', usedPercent: 12.2, resetsAt: RESET },
          { label: 'Weekly', usedPercent: 80, resetsAt: null },
        ],
        detail: null,
      },
    },
    {
      ...SNAPSHOT.accounts[0],
      id: 'acc-4',
      email: 'new@example.com',
      isDefault: false,
      usage: { windows: [], detail: 'Usage is not available on this plan.' },
    },
  ],
  login: { id: 'login-1', phase: 'waiting', url: 'https://claude.ai/oauth' },
  imports: [{ origin: 'cswap', email: 'swap@example.com' }],
});

describe('accounts', () => {
  test('lists each account with its use and flags, a sign-in under way and what can be imported', async () => {
    const fake = createFakeClient({ '/api/accounts': MIXED });
    expect((await runSpec(fake, ['accounts', 'list'])).text.split('\n')).toEqual([
      'acc-1  me@example.com  max  42% used  (default)',
      'acc-2  unknown email    0% used  (left out of new work, needs sign-in)',
      'acc-3  other@example.com  max  80% used',
      'acc-4  new@example.com  max  0% used',
      'Signing in: waiting at https://claude.ai/oauth',
      'Can import swap@example.com from cswap.',
    ]);
  });

  test('with no accounts it says so, and a sign-in without a URL yet shows its phase', async () => {
    const fake = createFakeClient({
      '/api/accounts': createAccountsSnapshot({ accounts: [] }),
      '/api/accounts/refresh': createAccountsSnapshot({
        accounts: [],
        login: { id: 'login-1', phase: 'starting', url: null },
      }),
    });
    expect((await runSpec(fake, ['accounts', 'list'])).text).toBe('No Claude accounts.');
    expect((await runSpec(fake, ['accounts', 'refresh'])).text).toBe('Signing in: starting');
    expect(fake.posts).toEqual([{ path: '/api/accounts/refresh', body: {} }]);
  });

  test('sign-in starts in the browser and says how to finish; the code finishes it', async () => {
    const fake = createFakeClient({
      '/api/accounts': SNAPSHOT,
      '/api/accounts/login': (_path: string, body: unknown) =>
        (body as { accountId: string | null }).accountId
          ? createAccountsSnapshot({ login: { id: 'login-2', phase: 'starting', url: null } })
          : createAccountsSnapshot({
              login: { id: 'login-1', phase: 'waiting', url: 'https://claude.ai/oauth' },
            }),
      '/api/accounts/login/code': SNAPSHOT,
    });
    expect((await runSpec(fake, ['accounts', 'sign-in'])).text).toBe(
      'Sign-in login-1: https://claude.ai/oauth. Then run `shinsa accounts sign-in-code login-1 <code>`.'
    );
    expect((await runSpec(fake, ['accounts', 'sign-in', 'me@example.com'])).text).toBe(
      'Sign-in login-2: starting. Then run `shinsa accounts sign-in-code login-2 <code>`.'
    );
    expect((await runSpec(fake, ['accounts', 'sign-in-code', 'login-1', 'abc'])).text).toBe(
      'acc-1  me@example.com  max  42% used  (default)'
    );
    expect(fake.posts).toEqual([
      { path: '/api/accounts/login', body: { accountId: null } },
      { path: '/api/accounts/login', body: { accountId: 'acc-1' } },
      { path: '/api/accounts/login/code', body: { loginId: 'login-1', code: 'abc' } },
    ]);
  });

  test('a sign-in the server finished at once lists the accounts', async () => {
    const fake = createFakeClient({ '/api/accounts/login': SNAPSHOT });
    expect((await runSpec(fake, ['accounts', 'sign-in'])).text).toBe(
      'acc-1  me@example.com  max  42% used  (default)'
    );
  });

  test('import, update and remove post to the account routes', async () => {
    const fake = createFakeClient({
      '/api/accounts': SNAPSHOT,
      '/api/accounts/import': SNAPSHOT,
      '/api/accounts/update': SNAPSHOT,
      '/api/accounts/remove': createAccountsSnapshot({ accounts: [] }),
    });
    await runSpec(fake, ['accounts', 'import', 'cswap', 'swap@example.com']);
    await runSpec(fake, [
      'accounts',
      'update',
      'acc-1',
      '--default',
      '--paused=false',
      '--switch-at',
      '0',
      '--position',
      '2',
    ]);
    await runSpec(fake, ['accounts', 'update', 'acc-1', '--switch-at', '90']);
    await runSpec(fake, ['accounts', 'update', 'acc-1', '--paused']);
    expect((await runSpec(fake, ['accounts', 'remove', 'me@example.com'])).text).toBe('No Claude accounts.');
    expect(fake.posts).toEqual([
      { path: '/api/accounts/import', body: { origin: 'cswap', email: 'swap@example.com' } },
      {
        path: '/api/accounts/update',
        body: { accountId: 'acc-1', patch: { isDefault: true, paused: false, switchAt: null, position: 2 } },
      },
      { path: '/api/accounts/update', body: { accountId: 'acc-1', patch: { switchAt: 90 } } },
      { path: '/api/accounts/update', body: { accountId: 'acc-1', patch: { paused: true } } },
      { path: '/api/accounts/remove', body: { accountId: 'acc-1' } },
    ]);
  });
});

describe('usage', () => {
  test('shows each window with its reset, a spent account and an account without readings', async () => {
    const fake = createFakeClient({ '/api/accounts': MIXED });
    expect((await runSpec(fake, ['usage'])).text.split('\n')).toEqual([
      'me@example.com',
      '  Session: 42%',
      'acc-2 (out of usage until 2026-10-23T18:00:00.000Z)',
      '  No usage reported yet.',
      'other@example.com',
      '  Session: 12%, resets 2026-10-23T18:00:00.000Z',
      '  Weekly: 80%',
      'new@example.com',
      '  Usage is not available on this plan.',
    ]);
    const none = createFakeClient({ '/api/accounts': createAccountsSnapshot({ accounts: [] }) });
    expect((await runSpec(none, ['usage'])).text).toBe('No Claude accounts.');
  });
});

describe('the server', () => {
  test('lists the providers and their models', async () => {
    const fake = createFakeClient({
      '/api/providers': [
        { id: 'claude', label: 'Claude', models: [{ id: 'opus' }, { id: 'sonnet' }] },
        { id: 'codex', label: 'Codex', models: [{ id: 'gpt-6' }] },
      ],
    });
    expect((await runSpec(fake, ['providers'])).text).toBe(
      'claude (Claude): opus, sonnet\ncodex (Codex): gpt-6'
    );
  });

  test('health says the log is clean, or lists what it skipped', async () => {
    const fake = createFakeClient({ '/api/health': { ok: true, seq: 12, problems: [] } });
    expect((await runSpec(fake, ['health'])).text).toBe('Healthy. 12 events in the log.');
    const damaged = createFakeClient({
      '/api/health': {
        ok: false,
        seq: 12,
        problems: [{ seq: 4, type: 'task.created', kind: 'unappliable', error: 'No such task.' }],
      },
    });
    expect((await runSpec(damaged, ['health'])).text).toBe(
      'Skipped 1 damaged entries at start:\n  #4 task.created: No such task.'
    );
  });

  test('the queue lists the decisions and the agents at work', async () => {
    const fake = createFakeClient({
      '/api/queue': {
        briefing: null,
        decisions: [{ label: 'Review', title: 'Add search', url: 'http://x/tasks/1' }],
        working: [{ label: 'Building', title: 'Fix scroll' }],
      },
    });
    expect((await runSpec(fake, ['queue'])).text).toBe(
      'Needs you (1)\n  Review    Add search  http://x/tasks/1\nAgents working (1)\n  Building  Fix scroll'
    );
  });

  test('activity lists what agents did on your behalf and from which task, or that nothing happened yet', async () => {
    const fake = createFakeClient({
      '/api/activity': {
        actions: [
          { at: RESET, command: 'task.create', taskId: 't', summary: 'Created “Fix”', byTask: 'SW-3' },
          { at: RESET, command: 'task.complete', taskId: 't', summary: 'Marked “Fix” as done' },
        ],
      },
    });
    expect((await runSpec(fake, ['activity'])).text).toBe(
      '2026-10-23T18:00:00.000Z  Created “Fix”  (the agent of SW-3)\n2026-10-23T18:00:00.000Z  Marked “Fix” as done'
    );
    const empty = createFakeClient({ '/api/activity': { actions: [] } });
    expect((await runSpec(empty, ['activity'])).text).toBe('Nothing yet.');
  });

  test('setup status names where the data lives, and the check lists each tool', async () => {
    const status = (completed: boolean) => ({
      completed,
      paths: { dataDir: '/data', configPath: '/config.json' },
    });
    const fake = createFakeClient({
      '/api/onboarding': status(true),
      '/api/onboarding/prerequisites': {
        ready: false,
        checks: [
          { label: 'git', ok: true, detail: '2.50', fix: null },
          { label: 'gh', ok: false, detail: 'not found', fix: 'brew install gh' },
        ],
      },
    });
    expect((await runSpec(fake, ['setup', 'status'])).text).toBe(
      'Setup is done.\nData: /data\nConfig: /config.json'
    );
    expect((await runSpec(fake, ['setup', 'check'])).text).toBe(
      'ok   git: 2.50\nfail gh: not found (brew install gh)'
    );
    const unfinished = createFakeClient({ '/api/onboarding': status(false) });
    expect((await runSpec(unfinished, ['setup', 'status'])).text).toContain('Setup is not finished.');
  });
});
