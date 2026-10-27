import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderLogin, RunAccount, RunFailure, ShinsaCommand } from '@shinsa/core';
import { Cswap } from '../../src/accounts/cswap.ts';
import { Accounts, createOnboardingAccounts } from '../../src/accounts/index.ts';
import type { LoginProcess, LoginSpawner } from '../../src/accounts/login.ts';
import { resolveKeychainService } from '../../src/accounts/paths.ts';
import type { StoredAccount } from '../../src/accounts/store.ts';
import type { RunRejection } from '../../src/agents/index.ts';
import type { ProviderUsageReading, ProviderUsageSource } from '../../src/agents/providers/index.ts';
import { log } from '../../src/log/index.ts';
import { type CommandOptions, type CommandResult, runCommand } from '../../src/shell/index.ts';
import { createTempDir, createTestConfig, overrideEnv, until } from '../helpers/index.ts';
import { createGate, createRun, createStubEngine, createTask, type StubEngine } from '../helpers/state.ts';

const HOUR = 60 * 60 * 1000;

interface Status {
  loggedIn: boolean;
  email?: string;
  orgName?: string;
  subscriptionType?: string;
}

interface Call {
  command: string[];
  env: Record<string, string | undefined>;
}

interface FakeProcess extends LoginProcess {
  written: string[];
  exit: (code: number) => void;
  emit: (text: string) => void;
}

function result(stdout: string, ok = true): CommandResult {
  return { ok, code: ok ? 0 : 1, stdout, stderr: '', timedOut: false };
}

interface WorldOptions {
  registry?: boolean;
  inspect?: boolean;
  root?: string;
  now?: number;
  providerUsage?: ProviderUsageSource[];
  providerLogins?: () => Promise<ProviderLogin[]>;
}

function createWorld(options: WorldOptions = {}) {
  const root = options.root ?? createTempDir();
  const config = createTestConfig(root, { inspect: options.inspect ?? false });
  const shared = join(root, 'shared-claude');
  mkdirSync(join(shared, 'projects'), { recursive: true });
  writeFileSync(join(shared, 'settings.json'), '{}');
  writeFileSync(join(shared, '.claude.json'), JSON.stringify({ theme: 'dark', secret: 'never copied' }));
  if (options.registry)
    writeFileSync(join(root, 'accounts.json'), JSON.stringify({ version: 1, accounts: [] }));
  const statuses = new Map<string, Status>();
  const calls: Call[] = [];
  const secrets = new Map<string, string>();
  const secretReads: string[] = [];
  const usage = new Map<string, unknown>();
  const processes: FakeProcess[] = [];
  let cswapList: unknown = { accounts: [] };
  let cswapExport: unknown = null;
  let now = options.now ?? 1_000_000;
  const stub: StubEngine = createStubEngine();
  const run = (command: string[], _cwd: string, commandOptions: CommandOptions): Promise<CommandResult> => {
    const env = commandOptions.env ?? {};
    calls.push({ command, env });
    if (command[0] === '/bin/cswap' && command[1] === 'list')
      return Promise.resolve(result(JSON.stringify(cswapList)));
    if (command[0] === '/bin/cswap' && command[1] === 'export') {
      return Promise.resolve(cswapExport ? result(JSON.stringify(cswapExport)) : result('', false));
    }
    if (command[1] === 'auth' && command[2] === 'status') {
      const status = statuses.get(env.CLAUDE_CONFIG_DIR ?? 'default') ?? { loggedIn: false };
      return Promise.resolve(result(JSON.stringify(status), status.loggedIn));
    }
    return Promise.resolve(result(''));
  };
  const spawnLogin: LoginSpawner = (command, spawnOptions) => {
    const exit = Promise.withResolvers<number>();
    const process: FakeProcess = {
      written: [],
      write: (data) => process.written.push(data),
      kill: () => exit.resolve(143),
      exited: exit.promise,
      exit: (code) => exit.resolve(code),
      emit: (text) => spawnOptions.onData(text),
    };
    calls.push({ command, env: spawnOptions.env });
    processes.push(process);
    return process;
  };
  const accounts = new Accounts({
    engine: stub.engine,
    config,
    env: { CLAUDE_CONFIG_DIR: shared, USER: 'tester' },
    run,
    readSecret: (service) => {
      secretReads.push(service);
      return Promise.resolve(secrets.get(service) ?? null);
    },
    requestHttp: (_url, init) => {
      const token = (init.headers as Record<string, string>).Authorization?.replace('Bearer ', '') ?? '';
      const body = usage.get(token);
      return Promise.resolve(body ? Response.json(body) : new Response('no', { status: 401 }));
    },
    spawnLogin,
    cswap: new Cswap({ run, which: (name) => (name === 'cswap' ? '/bin/cswap' : null) }),
    resolveClaude: () => Promise.resolve('claude'),
    now: () => now,
    refreshIntervalMs: 60 * 60_000,
    loginTimers: { menuFallbackMs: 60_000, urlTimeoutMs: 60_000, watchdogMs: 60_000 },
    ...(options.providerUsage ? { providerUsage: options.providerUsage } : {}),
    ...(options.providerLogins ? { providerLogins: options.providerLogins } : {}),
  });
  return {
    root,
    config,
    shared,
    accounts,
    stub,
    statuses,
    calls,
    secrets,
    secretReads,
    usage,
    processes,
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
    setCswap: (list: unknown, exported: unknown) => {
      cswapList = list;
      cswapExport = exported;
    },
    login: (dir: string | null, token: string, plan = 'max') => {
      secrets.set(
        resolveKeychainService(dir ?? shared),
        JSON.stringify({
          claudeAiOauth: { accessToken: token, expiresAt: now + HOUR, subscriptionType: plan },
        })
      );
    },
  };
}

type World = ReturnType<typeof createWorld>;

function windows(session: number, weekly: number, fable = 0, resetsAt = '2030-01-01T00:00:00Z') {
  return {
    limits: [
      { kind: 'session', percent: session, resets_at: resetsAt },
      { kind: 'weekly_all', percent: weekly, resets_at: resetsAt },
      {
        kind: 'weekly_scoped',
        percent: fable,
        resets_at: resetsAt,
        scope: { model: { display_name: 'Fable' } },
      },
    ],
  };
}

async function addAccount(world: World, email: string, used: number, orgName?: string) {
  const before = new Set(world.accounts.store.list().map((existing) => existing.id));
  await world.accounts.startLogin(null);
  const account = world.accounts.store.list().find((candidate) => !before.has(candidate.id));
  if (!account?.configDir) throw new Error('no account was created');
  world.statuses.set(account.configDir, { loggedIn: true, email, orgName, subscriptionType: 'max' });
  world.login(account.configDir, `token-${email}`);
  world.usage.set(`token-${email}`, windows(used, used));
  world.processes.at(-1)?.exit(0);
  await until('the sign-in to finish', () => world.accounts.logins.current()?.phase === 'done');
  return world.accounts.store.find(account.id);
}

function failure(overrides: Partial<RunFailure>): RunFailure {
  return {
    class: 'usage_limit',
    message: 'Limit.',
    code: null,
    retryable: true,
    resetAt: null,
    ...overrides,
  };
}

function reject(
  world: World,
  accountId: string | null,
  overrides: Partial<RunFailure>,
  tried: string[] = accountId ? [accountId] : []
) {
  const rejection: RunRejection = {
    runId: 'run-1',
    taskId: 'task-1',
    provider: 'claude',
    attemptId: 'attempt-1',
    accountId,
    tried,
    failure: failure(overrides),
  };
  const verdict = world.accounts.onRejection(rejection);
  if (verdict instanceof Promise) throw new Error('A Claude rejection is answered at once.');
  return verdict;
}

function lease(
  world: World,
  overrides: {
    bound?: RunAccount | null;
    previous?: RunAccount | null;
    model?: string | null;
    exclude?: string[];
  } = {}
) {
  return world.accounts.lease({
    runId: 'run-1',
    taskId: 'task-1',
    model: overrides.model ?? null,
    bound: overrides.bound ?? null,
    previous: overrides.previous ?? null,
    exclude: overrides.exclude ?? [],
  });
}

function dispatched(world: World) {
  return world.stub.dispatched as ShinsaCommand[];
}

describe('adopting the login Claude Code already has', () => {
  test('the first start adds your signed-in Claude Code login as the default account', async () => {
    const world = createWorld();
    world.statuses.set('default', {
      loggedIn: true,
      email: 'me@example.com',
      subscriptionType: 'max',
      orgName: 'Me',
    });
    world.login(null, 'token-me');
    world.usage.set('token-me', windows(40, 20));
    await world.accounts.start();
    const [account] = world.accounts.snapshot().accounts;
    expect(account).toMatchObject({
      email: 'me@example.com',
      organization: 'Me',
      plan: 'max',
      origin: 'claude',
      isDefault: true,
      signIn: 'signed_in',
      runs: 0,
    });
    expect(account?.usage.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ['5-hour limit', 40],
      ['Weekly · All models', 20],
      ['Weekly · Fable', 0],
    ]);
    expect(world.accounts.store.find(account?.id ?? '').configDir).toBeNull();
    const heard: number[] = [];
    world.accounts.subscribe((snapshot) => heard.push(snapshot.accounts[0]?.runs ?? -1));
    world.accounts.store.update(account?.id ?? '', { paused: true });
    world.stub.update((state) => {
      state.runs['run-1'] = createRun({
        attempts: [
          {
            attemptId: 'a1',
            provider: 'claude',
            model: null,
            resumed: false,
            handoff: null,
            startedAt: 1,
            account: { id: account?.id ?? '', email: 'me@example.com' },
          },
        ],
      });
    });
    world.stub.notify();
    expect(heard).toEqual([0, 1]);
    world.accounts.stop();
  });

  test('a signed-out login is not adopted, and an existing account list is never filled in', async () => {
    const signedOut = createWorld();
    await signedOut.accounts.start();
    expect(signedOut.accounts.snapshot().accounts).toEqual([]);
    signedOut.accounts.stop();

    const listed = createWorld({ registry: true });
    listed.statuses.set('default', { loggedIn: true, email: 'me@example.com' });
    await listed.accounts.start();
    expect(listed.accounts.snapshot()).toMatchObject({
      accounts: [],
      imports: [{ origin: 'claude', email: 'me@example.com', plan: null }],
    });
    listed.accounts.stop();
  });

  test('a missing claude leaves the accounts as they are and says why', async () => {
    const world = createWorld();
    const warn = spyOn(log, 'warn');
    const broken = new Accounts({
      engine: world.stub.engine,
      config: createTestConfig(world.root),
      env: { CLAUDE_CONFIG_DIR: world.shared },
      run: () => Promise.resolve(result('')),
      readSecret: () => Promise.resolve(null),
      cswap: new Cswap({ run: () => Promise.resolve(result('')), which: () => null }),
      resolveClaude: () => Promise.reject(new Error('Claude Code is not installed.')),
    });
    await broken.start();
    broken.stop();
    expect(
      warn.mock.calls.some(([message]) => message === '[Accounts] Could not check your Claude Code login')
    ).toBe(true);
    warn.mockRestore();
  });

  test('the other providers’ sign-ins ride along in the snapshot, and one that cannot be read is logged', async () => {
    const world = createWorld();
    const warn = spyOn(log, 'warn');
    const codex = {
      provider: 'codex',
      label: 'Codex',
      status: 'signed_in' as const,
      method: 'ChatGPT',
      version: '0.153.4',
      detail: 'Signed in with ChatGPT.',
      fix: null,
    };
    let reads = 0;
    const accounts = new Accounts({
      engine: world.stub.engine,
      config: createTestConfig(world.root),
      env: { CLAUDE_CONFIG_DIR: world.shared },
      run: () => Promise.resolve(result('')),
      readSecret: () => Promise.resolve(null),
      cswap: new Cswap({ run: () => Promise.resolve(result('')), which: () => null }),
      resolveClaude: () => Promise.resolve('claude'),
      providerLogins: () => {
        reads += 1;
        return reads === 1 ? Promise.resolve([codex]) : Promise.reject(new Error('codex hung'));
      },
    });
    await accounts.start();
    expect(accounts.snapshot().providers).toEqual([codex]);
    expect((await accounts.refresh()).providers).toEqual([codex]);
    accounts.stop();
    expect(
      warn.mock.calls.some(
        ([message]) => message === '[Accounts] Could not check the other providers’ sign-ins'
      )
    ).toBe(true);
    warn.mockRestore();
    expect(world.accounts.snapshot().providers).toEqual([]);
  });

  test('stopping before the start finishes never leaves a timer behind', async () => {
    const world = createWorld();
    const starting = world.accounts.start();
    world.accounts.stop();
    await starting;
    world.accounts.stop();
  });
});

describe('signing in an account', () => {
  test('a new account gets its own Claude folder, signs in there, and retries the tasks waiting on it', async () => {
    const world = createWorld({ registry: true });
    const heard: unknown[] = [];
    const unsubscribe = world.accounts.subscribe((snapshot) => heard.push(snapshot.login?.phase));
    const account = await addAccount(world, 'work@example.com', 30);
    unsubscribe();
    expect(account).toMatchObject({ email: 'work@example.com', plan: 'max', origin: 'login' });
    expect(account.configDir?.startsWith(join(world.root, 'accounts'))).toBe(true);
    const login = world.calls.find((call) => call.command[1] === 'auth' && call.command[2] === 'login');
    expect(login).toEqual({
      command: ['claude', 'auth', 'login', '--claudeai'],
      env: { CLAUDE_CONFIG_DIR: account.configDir as string },
    });
    expect(existsSync(join(account.configDir as string, 'settings.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(account.configDir as string, '.claude.json'), 'utf8'))).toEqual({
      hasCompletedOnboarding: true,
      theme: 'dark',
    });
    expect(dispatched(world)).toContainEqual({
      type: 'account.signed_in',
      account: { id: account.id, email: 'work@example.com' },
    });
    const signedIn = dispatched(world).findIndex((command) => command.type === 'account.signed_in');
    expect(world.stub.commandIds[signedIn]).toBe(
      `login:${world.accounts.logins.current()?.id}:account.signed_in`
    );
    expect(world.accounts.snapshot().accounts[0]).toMatchObject({ signIn: 'signed_in', isDefault: true });
    expect(heard).toContain('done');
  });

  test('a new account whose sign-in fails is removed again, and one that already exists is refused', async () => {
    const world = createWorld({ registry: true });
    await world.accounts.startLogin(null);
    const [created] = world.accounts.store.list();
    world.processes[0]?.exit(1);
    await until('the account to be removed', () => world.accounts.store.list().length === 0);
    expect(existsSync(created?.configDir as string)).toBe(false);
    expect(world.calls.some((call) => call.command[2] === 'logout')).toBe(true);

    const first = await addAccount(world, 'work@example.com', 10);
    await world.accounts.startLogin(null);
    const twin = world.accounts.store.list().find((account) => account.id !== first.id);
    world.statuses.set(twin?.configDir as string, { loggedIn: true, email: 'WORK@example.com' });
    world.processes.at(-1)?.exit(0);
    await until('the duplicate to fail', () => world.accounts.logins.current()?.phase === 'failed');
    expect(world.accounts.snapshot().login?.message).toBe('WORK@example.com is already in your accounts.');
    await until('the duplicate to be removed', () => world.accounts.store.list().length === 1);
  });

  test('signing an existing account in again keeps it, and a sign-in that stays signed out says so', async () => {
    const world = createWorld({ registry: true });
    const account = await addAccount(world, 'work@example.com', 10);
    await world.accounts.startLogin(account.id);
    world.statuses.set(account.configDir as string, { loggedIn: false });
    world.processes.at(-1)?.exit(0);
    await until('the sign-in to fail', () => world.accounts.logins.current()?.phase === 'failed');
    expect(world.accounts.snapshot().login?.message).toBe(
      'Sign-in finished, but Claude still reports this account as signed out.'
    );
    expect(world.accounts.store.select(account.id)).not.toBeNull();
  });

  test('a code can be pasted while the sign-in waits, and a finished sign-in can be cleared', async () => {
    const world = createWorld({ registry: true });
    const snapshot = await world.accounts.startLogin(null);
    const loginId = snapshot.login?.id ?? '';
    expect(() => world.accounts.submitLoginCode(loginId, '')).toThrow(
      'Paste the code the sign-in page showed.'
    );
    expect(() => world.accounts.submitLoginCode(loginId, 'abc')).toThrow(
      'That sign-in is no longer waiting for a code. Start it again.'
    );
    world.processes[0]?.emit('Visit https://claude.com/cai/oauth/authorize?code=true to sign in');
    expect(world.accounts.snapshot().login).toMatchObject({ phase: 'waiting' });
    expect(world.accounts.submitLoginCode(loginId, ' abc ').login?.phase).toBe('finishing');
    expect(world.processes[0]?.written).toEqual(['abc\r']);
    expect(() => world.accounts.cancelLogin(42)).toThrow('Name the sign-in to cancel.');
    world.accounts.cancelLogin(loginId);
    expect(world.accounts.snapshot().login?.phase).toBe('failed');
    world.accounts.cancelLogin(loginId);
    expect(world.accounts.snapshot().login).toBeNull();
  });

  test('a sign-in for an account removed meanwhile fails plainly', async () => {
    const world = createWorld({ registry: true });
    const account = await addAccount(world, 'work@example.com', 10);
    await world.accounts.startLogin(account.id);
    world.accounts.store.remove(account.id);
    world.processes.at(-1)?.exit(0);
    await until('the sign-in to fail', () => world.accounts.logins.current()?.phase === 'failed');
    expect(world.accounts.snapshot().login?.message).toBe('The account was removed while you signed in.');
  });
});

describe('inspect mode', () => {
  test('shows the stored accounts without reading a login or usage, and refuses to refresh or change them', async () => {
    const live = createWorld({ registry: true });
    const account = await addAccount(live, 'seen@example.com', 20);
    live.accounts.stop();
    const registry = readFileSync(join(live.root, 'accounts.json'), 'utf8');
    const world = createWorld({ root: live.root, inspect: true });
    await world.accounts.start();
    expect(world.accounts.snapshot().accounts.map((listed) => listed.email)).toEqual(['seen@example.com']);
    const refused = { code: 'inspect_read_only' };
    await expect(world.accounts.refresh()).rejects.toMatchObject(refused);
    expect(() => world.accounts.update(account.id, { paused: true })).toThrow(
      'Start it without SHINSA_INSPECT to sign in, refresh or change accounts.'
    );
    world.accounts.stop();
    expect(world.calls).toEqual([]);
    expect(world.secretReads).toEqual([]);
    expect(readFileSync(join(live.root, 'accounts.json'), 'utf8')).toBe(registry);
  });
});

describe('importing logins', () => {
  test('your Claude Code login can be added as an account without copying it', async () => {
    const world = createWorld({ registry: true });
    world.statuses.set('default', { loggedIn: true, email: 'me@example.com', subscriptionType: 'pro' });
    await world.accounts.refresh();
    expect(world.accounts.snapshot().imports).toEqual([
      { origin: 'claude', email: 'me@example.com', plan: 'pro' },
    ]);
    const snapshot = await world.accounts.importAccount('claude', 'me@example.com');
    expect(snapshot.accounts[0]).toMatchObject({
      origin: 'claude',
      email: 'me@example.com',
      signIn: 'signed_in',
    });
    expect(snapshot.imports).toEqual([]);
    expect(() => world.accounts.store.create('claude')).toThrow(
      'Your Claude Code login is already in your accounts.'
    );
    await expect(world.accounts.importAccount('claude', 'other@example.com')).rejects.toThrow(
      'Your Claude Code login is no longer other@example.com. Check again.'
    );
  });

  test('an account from claude-swap is copied into its own folder and checked before it is kept', async () => {
    const world = createWorld({ registry: true });
    const oauth = { accessToken: 'a', refreshToken: 'r', expiresAt: 1 };
    world.setCswap(
      { accounts: [{ email: 'swap@example.com', organizationName: 'Swap' }] },
      {
        accounts: [
          {
            email: 'swap@example.com',
            credentials: { claudeAiOauth: oauth, mcpOAuth: { secret: 'machine' } },
            config: { oauthAccount: { emailAddress: 'swap@example.com', organizationName: 'Swap' } },
          },
        ],
      }
    );
    await world.accounts.refresh();
    expect(world.accounts.snapshot().imports).toEqual([
      { origin: 'cswap', email: 'swap@example.com', plan: null },
    ]);
    world.statuses.set('pending', { loggedIn: false });
    const original = world.accounts.store.create.bind(world.accounts.store);
    let dir = '';
    world.accounts.store.create = (origin, details) => {
      const created = original(origin, details);
      dir = created.configDir as string;
      world.statuses.set(dir, { loggedIn: true, email: 'swap@example.com', subscriptionType: 'team' });
      return created;
    };
    const snapshot = await world.accounts.importAccount('cswap', 'swap@example.com');
    expect(snapshot.accounts[0]).toMatchObject({
      origin: 'cswap',
      email: 'swap@example.com',
      organization: 'Swap',
      plan: 'team',
    });
    expect(JSON.parse(readFileSync(join(dir, '.credentials.json'), 'utf8'))).toEqual({
      claudeAiOauth: oauth,
    });
    expect(statSync(join(dir, '.credentials.json')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dir, '.claude.json'), 'utf8')).oauthAccount.emailAddress).toBe(
      'swap@example.com'
    );
    await expect(world.accounts.importAccount('cswap', 'swap@example.com')).rejects.toThrow(
      'swap@example.com is already in your accounts.'
    );
  });

  test('a claude-swap login that does not hand over, or does not work, is not kept', async () => {
    const world = createWorld({ registry: true });
    world.setCswap({ accounts: [] }, null);
    await expect(world.accounts.importAccount('cswap', 'gone@example.com')).rejects.toThrow(
      'claude-swap did not hand over gone@example.com. Sign in to it instead.'
    );
    world.setCswap(
      { accounts: [] },
      { accounts: [{ email: 'dead@example.com', credentials: { claudeAiOauth: { refreshToken: 'r' } } }] }
    );
    await expect(world.accounts.importAccount('cswap', 'dead@example.com')).rejects.toThrow(
      'The copy of dead@example.com from claude-swap did not work. Sign in to it instead.'
    );
    expect(world.accounts.store.list()).toEqual([]);
  });

  test('an import names its account and comes from a known place', async () => {
    const world = createWorld({ registry: true });
    expect(() => world.accounts.importAccount('cswap', ' ')).toThrow('Name the account to import.');
    expect(() => world.accounts.importAccount('elsewhere', 'a@b.com')).toThrow(
      'Import your Claude Code login or an account from claude-swap.'
    );
  });
});

describe('one login, one account', () => {
  async function addClaudeLogin(world: World, email: string, orgName: string) {
    world.statuses.set('default', { loggedIn: true, email, orgName, subscriptionType: 'max' });
    world.login(null, `token-${email}-claude`);
    world.usage.set(`token-${email}-claude`, windows(40, 40));
    await world.accounts.refresh();
    await world.accounts.importAccount('claude', email);
    return world.accounts.store.list().find((account) => account.origin === 'claude') as StoredAccount;
  }

  test('your Claude Code login switching to an account Shinsa has shows one account and runs only on your login', async () => {
    const world = createWorld({ registry: true });
    const mine = await addClaudeLogin(world, 'me@example.com', 'Acme');
    const work = await addAccount(world, 'work@example.com', 10, 'Acme');
    world.accounts.update(work.id, { isDefault: true });
    expect(world.accounts.snapshot().accounts.map((account) => account.id)).toEqual([mine.id, work.id]);
    expect(world.accounts.snapshot().duplicates).toEqual([]);

    const info = spyOn(log, 'info');
    world.statuses.set('default', { loggedIn: true, email: 'WORK@example.com', orgName: 'acme' });
    world.login(null, 'token-work@example.com-claude');
    world.usage.set('token-work@example.com-claude', windows(20, 20));
    const snapshot = await world.accounts.refresh();
    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.accounts[0]).toMatchObject({ id: mine.id, email: 'WORK@example.com', isDefault: true });
    expect(snapshot.duplicates).toEqual([{ id: work.id, email: 'work@example.com', keptId: mine.id }]);
    expect(
      info.mock.calls.filter(([message]) => String(message).startsWith('[Accounts] Two accounts hold'))
    ).toEqual([
      [
        '[Accounts] Two accounts hold the same login; Shinsa uses one and leaves the other alone',
        { accountId: work.id, keptId: mine.id, email: 'work@example.com' },
      ],
    ]);
    info.mockRestore();

    expect(await lease(world)).toMatchObject({ id: mine.id, configDir: null });
    const bound = { id: work.id, email: work.email };
    expect(await lease(world, { bound })).toMatchObject({ id: mine.id, reason: null });
    expect(await lease(world, { previous: bound })).toMatchObject({ id: mine.id, reason: null });
    world.stub.update((state) => {
      state.runs['run-1'] = createRun({ account: bound });
    });
    expect(reject(world, mine.id, { resetAt: world.now + HOUR })).toMatchObject({
      retry: false,
      failure: { resetAt: world.now + HOUR },
    });

    const reads = world.secretReads.length;
    await world.accounts.refresh();
    expect(world.secretReads.slice(reads)).toEqual([resolveKeychainService(world.shared)]);

    world.statuses.set('default', { loggedIn: true, email: 'me@example.com', orgName: 'Acme' });
    const back = await world.accounts.refresh();
    expect(back.accounts.map((account) => account.id)).toEqual([mine.id, work.id]);
    expect(back.accounts.map((account) => account.isDefault)).toEqual([false, true]);
    expect(back.duplicates).toEqual([]);
  });

  test('an account already held by your Claude Code login is neither offered nor imported from claude-swap', async () => {
    const world = createWorld({ registry: true });
    await addClaudeLogin(world, 'me@example.com', 'Acme');
    const login = {
      email: 'me@example.com',
      credentials: { claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } },
      config: { oauthAccount: { emailAddress: 'me@example.com', organizationName: 'Acme' } },
    };
    world.setCswap({ accounts: [{ email: 'me@example.com' }] }, { accounts: [login] });
    await world.accounts.refresh();
    expect(world.accounts.snapshot().imports).toEqual([]);
    await expect(world.accounts.importAccount('cswap', 'ME@example.com')).rejects.toThrow(
      'ME@example.com is already in your accounts.'
    );
    expect(world.accounts.store.list()).toHaveLength(1);
  });

  test('the same email in another organization is another account, and a new sign-in to one you have is refused', async () => {
    const world = createWorld({ registry: true });
    const mine = await addClaudeLogin(world, 'me@example.com', 'Acme');
    const team = await addAccount(world, 'me@example.com', 10, 'Team');
    expect(world.accounts.snapshot().accounts.map((account) => account.id)).toEqual([mine.id, team.id]);

    await world.accounts.startLogin(null);
    const twin = world.accounts.store.list().find((account) => ![mine.id, team.id].includes(account.id));
    world.statuses.set(twin?.configDir as string, {
      loggedIn: true,
      email: 'me@example.com',
      orgName: 'Team',
    });
    world.processes.at(-1)?.exit(0);
    await until('the duplicate to fail', () => world.accounts.logins.current()?.phase === 'failed');
    expect(world.accounts.snapshot().login?.message).toBe('me@example.com is already in your accounts.');
    await until('the duplicate to be removed', () => world.accounts.store.list().length === 2);
  });
});

describe('choosing the account for an attempt', () => {
  test('with no accounts the run keeps the login it would have used anyway', async () => {
    const world = createWorld({ registry: true });
    expect(await lease(world)).toBeNull();
  });

  test('the default account is used while it is below the threshold, then the one with most headroom', async () => {
    const world = createWorld({ registry: true });
    const busy = await addAccount(world, 'busy@example.com', 50);
    const idle = await addAccount(world, 'idle@example.com', 10);
    const spare = await addAccount(world, 'spare@example.com', 30);
    expect(await lease(world)).toMatchObject({
      id: busy.id,
      email: 'busy@example.com',
      configDir: busy.configDir,
      reason: null,
    });
    world.usage.set('token-busy@example.com', windows(95, 50));
    await world.accounts.refresh();
    expect(await lease(world, { previous: { id: busy.id, email: busy.email } })).toMatchObject({
      id: idle.id,
      reason: 'headroom',
    });
    expect(await lease(world, { previous: { id: spare.id, email: spare.email } })).toMatchObject({
      id: spare.id,
      reason: null,
    });
  });

  test('a run starts from the cached weekly reading and ends on a fresh one, each with its time and reset', async () => {
    const world = createWorld({ registry: true });
    const account = await addAccount(world, 'weekly@example.com', 20);
    await world.accounts.refresh();
    world.usage.set('token-weekly@example.com', windows(30, 24));
    const resetsAt = Date.parse('2030-01-01T00:00:00Z');
    expect(await world.accounts.readWeeklyReading(account.id, false)).toMatchObject({
      percent: 20,
      resetsAt,
    });
    const fresh = await world.accounts.readWeeklyReading(account.id, true);
    expect(fresh).toEqual({ percent: 24, at: expect.any(Number), resetsAt });
    expect(await world.accounts.readWeeklyReading('gone', true)).toBeNull();
  });

  test('a weekly value a session pushed is read again, since its time is not known', async () => {
    const world = createWorld({ registry: true });
    const account = await addAccount(world, 'pushed@example.com', 20);
    await world.accounts.refresh();
    world.accounts.limits.recordPush(account.id, {
      kind: 'rate_limit',
      status: 'allowed_warning',
      limit: 'seven_day',
      utilization: 0.31,
      resetsAt: null,
    });
    world.usage.set('token-pushed@example.com', windows(30, 26));
    expect(await world.accounts.readWeeklyReading(account.id, false)).toMatchObject({ percent: 26 });
  });

  test('a model window counts only for runs on that model', async () => {
    const world = createWorld({ registry: true });
    const first = await addAccount(world, 'first@example.com', 10);
    const second = await addAccount(world, 'second@example.com', 20);
    world.usage.set('token-first@example.com', windows(10, 10, 95));
    await world.accounts.refresh();
    expect((await lease(world, { model: 'opus' }))?.id).toBe(first.id);
    expect((await lease(world, { model: 'fable' }))?.id).toBe(second.id);
  });

  test('a bound task always gets its account, and one bound to a removed account falls back to the login', async () => {
    const world = createWorld({ registry: true });
    const spent = await addAccount(world, 'spent@example.com', 100);
    await addAccount(world, 'fresh@example.com', 0);
    const bound = { id: spent.id, email: spent.email };
    expect(await lease(world, { bound })).toMatchObject({ id: spent.id, reason: null });
    expect(await lease(world, { bound, previous: { id: 'other', email: null } })).toMatchObject({
      reason: 'bound',
    });
    const warn = spyOn(log, 'warn');
    expect(await lease(world, { bound: { id: 'gone', email: null } })).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[Accounts] The account a task is bound to is gone; using the default login',
      {
        taskId: 'task-1',
        accountId: 'gone',
      }
    );
    warn.mockRestore();
  });

  test('when every account is spent the least spent one is tried, so the limit can be confirmed', async () => {
    const world = createWorld({ registry: true });
    await addAccount(world, 'late@example.com', 10);
    const early = await addAccount(world, 'early@example.com', 10);
    reject(world, world.accounts.store.list()[0]?.id ?? '', { resetAt: world.now + 3 * HOUR });
    reject(world, early.id, { resetAt: world.now + HOUR });
    expect((await lease(world, { previous: { id: early.id, email: early.email } }))?.id).toBe(early.id);
  });
});

describe('moving a rejected attempt to another account', () => {
  test('a usage limit marks the account spent and retries on the next one, at most once per account', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    const b = await addAccount(world, 'b@example.com', 20);
    const c = await addAccount(world, 'c@example.com', 30);
    world.stub.update((state) => {
      state.tasks['task-1'] = createTask();
      state.runs['run-1'] = createRun({ model: 'opus' });
    });
    expect(reject(world, a.id, { resetAt: world.now + HOUR })).toEqual({ retry: true });
    expect(world.accounts.snapshot().accounts[0]?.spentUntil).toBe(world.now + HOUR);
    expect((await lease(world, { previous: { id: a.id, email: a.email }, exclude: [a.id] }))?.id).toBe(b.id);
    expect(reject(world, b.id, { resetAt: world.now + 2 * HOUR }, [a.id, b.id])).toEqual({ retry: true });
    expect((await lease(world, { exclude: [a.id, b.id] }))?.id).toBe(c.id);
    const last = reject(world, c.id, { resetAt: world.now + 3 * HOUR }, [a.id, b.id, c.id]);
    expect(last.retry).toBe(false);
    expect(last.failure).toMatchObject({
      class: 'usage_limit',
      resetAt: world.now + HOUR,
      account: { id: c.id, email: 'c@example.com' },
    });
  });

  test('the accounts a run already tried come with the rejection, so nothing is remembered between runs', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    const b = await addAccount(world, 'b@example.com', 10);
    const c = await addAccount(world, 'c@example.com', 10);
    await addAccount(world, 'd@example.com', 10);
    for (const account of [a, b, c]) {
      expect(reject(world, account.id, { resetAt: world.now + 60_000 })).toEqual({ retry: true });
    }
    expect(reject(world, a.id, { resetAt: world.now + 60_000 }, [b.id, c.id, a.id]).retry).toBe(false);
    world.advance(60_000);
    expect((await lease(world))?.email).toBe('a@example.com');
  });

  test('a bound task never moves: it waits for its own account to reset', async () => {
    const world = createWorld({ registry: true });
    const bound = await addAccount(world, 'bound@example.com', 10);
    await addAccount(world, 'free@example.com', 10);
    world.stub.update((state) => {
      state.tasks['task-1'] = createTask({ account: { id: bound.id, email: bound.email } });
    });
    const verdict = reject(world, bound.id, { resetAt: world.now + 4 * HOUR });
    expect(verdict).toEqual({
      retry: false,
      failure: failure({
        resetAt: world.now + 4 * HOUR,
        account: { id: bound.id, email: 'bound@example.com' },
      }),
    });
  });

  test('a run bound to an account never moves either, even when its task may run anywhere', async () => {
    const world = createWorld({ registry: true });
    const bound = await addAccount(world, 'bound@example.com', 10);
    await addAccount(world, 'free@example.com', 10);
    world.stub.update((state) => {
      state.tasks['task-1'] = createTask({ account: null });
      state.runs['run-1'] = createRun({ account: { id: bound.id, email: bound.email } });
    });
    const verdict = reject(world, bound.id, { resetAt: world.now + 4 * HOUR });
    expect(verdict).toMatchObject({ retry: false, failure: { resetAt: world.now + 4 * HOUR } });
  });

  test('an unknown reset blocks for a while, but never invents a time to resume at', async () => {
    const world = createWorld({ registry: true });
    const only = await addAccount(world, 'only@example.com', 10);
    const verdict = reject(world, only.id, { resetAt: null });
    expect(verdict.failure?.resetAt).toBeNull();
    expect(world.accounts.snapshot().accounts[0]?.spentUntil).toBe(world.now + 15 * 60_000);
  });

  test('a spent account stays spent after a restart until it resets', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    const b = await addAccount(world, 'b@example.com', 10);
    reject(world, a.id, { resetAt: world.now + HOUR });
    const restarted = createWorld({ root: world.root, now: world.now + 1 });
    const spentUntil = (current: World) =>
      current.accounts.snapshot().accounts.find((account) => account.id === a.id)?.spentUntil;
    expect(spentUntil(restarted)).toBe(world.now + HOUR);
    expect((await lease(restarted))?.id).toBe(b.id);
    await restarted.accounts.startLogin(a.id);
    restarted.statuses.set(a.configDir ?? '', { loggedIn: true, email: 'a@example.com' });
    restarted.processes.at(-1)?.exit(0);
    await until('the sign-in', () => restarted.accounts.logins.current()?.phase === 'done');
    expect(spentUntil(createWorld({ root: world.root, now: world.now + 2 }))).toBeNull();

    reject(world, a.id, { resetAt: world.now + HOUR });
    expect(spentUntil(createWorld({ root: world.root, now: world.now + HOUR }))).toBeNull();
    expect((await lease(createWorld({ root: world.root, now: world.now + HOUR })))?.id).toBe(a.id);
  });

  test('an unreadable list of spent accounts is logged and Shinsa starts without it', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    const path = join(world.config.dataDir, 'account-marks.json');
    writeFileSync(
      path,
      JSON.stringify({
        marks: { [a.id]: { until: 'soon', at: 1 }, other: null, gone: { until: null, at: 1 } },
      })
    );
    expect(createWorld({ root: world.root }).accounts.snapshot().accounts[0]?.spentUntil).toBeNull();
    writeFileSync(path, '{ not json');
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      expect(createWorld({ root: world.root }).accounts.snapshot().accounts[0]?.spentUntil).toBeNull();
      expect(warn.mock.calls.map((call) => call[0])).toEqual([
        '[Accounts] The spent accounts could not be read; starting without them',
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test('a spent mark that cannot be written is logged and still keeps the account out', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    mkdirSync(join(world.config.dataDir, 'account-marks.json'), { recursive: true });
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      reject(world, a.id, { resetAt: world.now + HOUR });
      expect(world.accounts.snapshot().accounts[0]?.spentUntil).toBe(world.now + HOUR);
      expect(warn.mock.calls.map((call) => call[0])).toContain(
        '[Accounts] Could not keep the spent accounts'
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('a signed-out account asks for a sign-in unless another account can take over', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    expect(reject(world, a.id, { class: 'auth', message: 'Signed out.' })).toEqual({
      retry: false,
      failure: failure({
        class: 'auth',
        message: 'Signed out.',
        account: { id: a.id, email: 'a@example.com' },
      }),
    });
    expect(world.accounts.snapshot().accounts[0]).toMatchObject({
      signIn: 'signed_out',
      signInDetail: 'Signed out.',
    });
    await addAccount(world, 'b@example.com', 10);
    expect(reject(world, a.id, { class: 'auth', message: 'Signed out.' })).toEqual({ retry: true });
  });

  test('other failures, and attempts without a known account, are left alone', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    expect(reject(world, a.id, { class: 'overloaded' })).toEqual({ retry: false });
    expect(reject(world, null, {})).toEqual({ retry: false });
    expect(reject(world, 'removed', {})).toEqual({ retry: false });
  });
});

describe('what runs report back', () => {
  test('a pushed rate-limit lands on the account of the run that saw it, and the account notice names it', async () => {
    const world = createWorld({ registry: true });
    const account = await addAccount(world, 'a@example.com', 10);
    world.stub.update((state) => {
      state.runs['run-1'] = createRun({
        attempts: [
          {
            attemptId: 'a1',
            provider: 'claude',
            model: null,
            resumed: false,
            handoff: null,
            startedAt: 1,
            account: { id: account.id, email: account.email },
          },
        ],
      });
    });
    world.stub.notify();
    expect(world.accounts.snapshot().accounts[0]?.runs).toBe(1);
    world.accounts.onNotice('run-1', {
      kind: 'rate_limit',
      status: 'rejected',
      limit: 'five_hour',
      resetsAt: 5_000,
      utilization: null,
    });
    expect(world.accounts.snapshot().accounts[0]?.usage.windows[0]).toMatchObject({
      id: 'five_hour',
      usedPercent: 100,
    });
    world.accounts.onNotice('run-1', {
      kind: 'account',
      email: 'renamed@example.com',
      organization: null,
      plan: null,
    });
    expect(world.accounts.snapshot().accounts[0]).toMatchObject({
      email: 'renamed@example.com',
      plan: 'max',
    });
    world.accounts.onNotice('run-1', { kind: 'account', email: null, organization: null, plan: null });
    world.accounts.onNotice('run-1', { kind: 'interrupted' });
    world.accounts.onNotice('run-2', { kind: 'interrupted' });
    world.accounts.store.remove(account.id);
    world.accounts.onNotice('run-1', {
      kind: 'account',
      email: 'x@example.com',
      organization: null,
      plan: null,
    });
    expect(world.accounts.store.list()).toEqual([]);
  });

  test('usage that cannot be read keeps what was known and says why', async () => {
    const world = createWorld({ registry: true });
    const account = await addAccount(world, 'a@example.com', 25);
    world.secrets.clear();
    await world.accounts.refresh();
    expect(world.accounts.snapshot().accounts[0]?.usage).toMatchObject({
      status: 'ok',
      detail: 'Shinsa could not find this account’s login. Sign in again.',
    });
    expect(world.accounts.snapshot().accounts[0]?.usage.windows[0]?.usedPercent).toBe(25);
    world.accounts.store.remove(account.id);
    expect(await world.accounts.limits.refresh([account.id], true)).toBeUndefined();
  });

  test('a stale reading is refreshed when an attempt is leased', async () => {
    const world = createWorld({ registry: true });
    await addAccount(world, 'a@example.com', 25);
    world.usage.set('token-a@example.com', windows(70, 25));
    world.advance(2 * 60_000);
    await lease(world);
    await until(
      'the new reading',
      () => world.accounts.snapshot().accounts[0]?.usage.windows[0]?.usedPercent === 70
    );
  });
});

describe('changing and removing accounts', () => {
  test('an account can be made the default, left out of new work, given its own threshold and moved', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    const b = await addAccount(world, 'b@example.com', 10);
    world.accounts.update(b.id, { isDefault: true });
    world.accounts.update(a.id, { paused: true, switchAt: 80 });
    world.accounts.update(b.id, { position: 0 });
    expect(
      world.accounts
        .snapshot()
        .accounts.map((account) => [account.email, account.isDefault, account.paused, account.switchAt])
    ).toEqual([
      ['b@example.com', true, false, null],
      ['a@example.com', false, true, 80],
    ]);
    world.accounts.update(a.id, { switchAt: null });
    expect(world.accounts.store.find(a.id).switchAt).toBeNull();
  });

  test('a change that is not one an account has is refused with the reason', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    for (const [patch, message] of [
      [null, 'Say what to change about the account.'],
      [[], 'Say what to change about the account.'],
      [{ color: 'red' }, 'An account has no setting called color.'],
      [{ isDefault: false }, 'Choose the default account by making one the default.'],
      [{ paused: 'yes' }, 'Say whether the account is paused with true or false.'],
      [{ switchAt: 0 }, 'Switch accounts at a whole percentage from 1 to 100.'],
      [{ switchAt: 50.5 }, 'Switch accounts at a whole percentage from 1 to 100.'],
      [{ position: 1.5 }, 'Give the account’s position as a whole number.'],
    ] as [unknown, string][]) {
      expect(() => world.accounts.update(a.id, patch)).toThrow(message);
    }
    expect(() => world.accounts.update(42, {})).toThrow('Name the account to change.');
    expect(() => world.accounts.update('missing', {})).toThrow('That account is no longer in your accounts.');
  });

  test('removing an account signs it out, deletes its folder and releases the tasks bound to it', async () => {
    const world = createWorld({ registry: true });
    const a = await addAccount(world, 'a@example.com', 10);
    const snapshot = await world.accounts.remove(a.id);
    expect(snapshot.accounts).toEqual([]);
    expect(existsSync(a.configDir as string)).toBe(false);
    expect(
      world.calls.some((call) => call.command[2] === 'logout' && call.env.CLAUDE_CONFIG_DIR === a.configDir)
    ).toBe(true);
    expect(dispatched(world)).toContainEqual({ type: 'account.removed', accountId: a.id });
    expect(world.stub.commandIds).toContain(`account.removed:${a.id}`);
    await expect(world.accounts.remove(42)).rejects.toThrow('Name the account to remove.');
  });

  test('removing your Claude Code login only takes it out of Shinsa, never signs it out', async () => {
    const world = createWorld({ registry: true });
    world.statuses.set('default', { loggedIn: true, email: 'me@example.com' });
    await world.accounts.importAccount('claude', 'me@example.com');
    const [account] = world.accounts.store.list();
    await world.accounts.remove(account?.id ?? '');
    expect(world.calls.some((call) => call.command[2] === 'logout')).toBe(false);
  });
});

describe('setup', () => {
  test('lists the accounts and the imports it can add, and imports one', async () => {
    const world = createWorld({ registry: true });
    world.statuses.set('default', { loggedIn: true, email: 'me@example.com', subscriptionType: 'max' });
    await world.accounts.refresh();
    const { source, actions } = createOnboardingAccounts(world.accounts);
    expect(await actions.listImports()).toEqual([{ origin: 'claude', email: 'me@example.com', plan: 'max' }]);
    await actions.importAccount('claude', 'me@example.com');
    expect(await source()).toEqual([
      { id: world.accounts.store.list()[0]?.id ?? '', email: 'me@example.com', signedIn: true },
    ]);
    expect(await actions.listImports()).toEqual([]);
  });
});

describe('when the outside world fails', () => {
  function brittle(world: World, overrides: Partial<ConstructorParameters<typeof Accounts>[0]> = {}) {
    return new Accounts({
      engine: world.stub.engine,
      config: createTestConfig(world.root),
      env: { CLAUDE_CONFIG_DIR: world.shared, USER: 'tester' },
      run: () => Promise.resolve(result('', false)),
      readSecret: () => Promise.reject(new Error('keychain locked')),
      cswap: new Cswap({ run: () => Promise.resolve(result('')), which: () => null }),
      resolveClaude: () => Promise.resolve('claude'),
      refreshIntervalMs: 5,
      ...overrides,
    });
  }

  test('a usage read that throws keeps what was known and says why, on the timer and on a lease', async () => {
    const world = createWorld({ registry: true });
    await addAccount(world, 'a@example.com', 10);
    let reads = 0;
    const accounts = brittle(world, {
      readSecret: () => {
        reads += 1;
        return Promise.reject(new Error('keychain locked'));
      },
    });
    await accounts.start();
    await until('the timer to read again', () => reads >= 2);
    expect(accounts.snapshot().accounts[0]?.usage.detail).toBe('Could not read usage: keychain locked');
    expect(accounts.snapshot().accounts[0]?.usage.windows[0]?.usedPercent).toBe(10);
    accounts.stop();
    const leasing = brittle(world);
    await leasing.lease({ runId: 'r', taskId: 't', model: null, bound: null, previous: null, exclude: [] });
    await until(
      'the lease to read',
      () => leasing.snapshot().accounts[0]?.usage.detail === 'Could not read usage: keychain locked'
    );
  });

  test('an account whose status cannot be read shows why, and a failed sign-out is logged', async () => {
    const world = createWorld({ registry: true });
    const account = await addAccount(world, 'a@example.com', 10);
    let missing = true;
    const accounts = brittle(world, {
      readSecret: () => Promise.resolve(null),
      resolveClaude: () =>
        missing ? Promise.reject(new Error('Claude Code is not installed.')) : Promise.resolve('claude'),
    });
    await accounts.syncSignIns();
    expect(accounts.snapshot().accounts[0]).toMatchObject({
      signIn: 'unknown',
      signInDetail: 'Claude Code is not installed.',
    });
    missing = false;
    const warn = spyOn(log, 'warn');
    await accounts.remove(account.id);
    expect(warn).toHaveBeenCalledWith('[Accounts] Could not sign a removed account out', {
      accountId: account.id,
      code: 1,
    });
    warn.mockRestore();
  });

  test('a new account that cannot be cleared after a failed sign-in is logged', async () => {
    const world = createWorld({ registry: true });
    let calls = 0;
    const accounts = brittle(world, {
      readSecret: () => Promise.resolve(null),
      spawnLogin: () => ({ write: () => undefined, kill: () => undefined, exited: Promise.resolve(1) }),
      resolveClaude: () => {
        calls += 1;
        return calls === 1 ? Promise.resolve('claude') : Promise.reject(new Error('gone'));
      },
      loginTimers: { menuFallbackMs: 60_000, urlTimeoutMs: 60_000, watchdogMs: 60_000 },
    });
    const warn = spyOn(log, 'warn');
    await accounts.startLogin(null);
    await until('the clean-up to fail', () =>
      warn.mock.calls.some(
        ([message]) => message === '[Accounts] Could not clear an account that never signed in'
      )
    );
    warn.mockRestore();
  });

  test('commands for an account folder never inherit a login the server’s environment would force', async () => {
    const world = createWorld({ registry: true });
    const dir = createTempDir();
    const seen = join(dir, 'seen.log');
    const claude = join(dir, 'claude');
    writeFileSync(
      claude,
      `#!/bin/sh\nprintf '%s %s:%s\\n' "$2" "\${ANTHROPIC_API_KEY:-none}" "\${CLAUDE_CODE_OAUTH_TOKEN:-none}" >> '${seen}'\necho '{"loggedIn": false}'\n`,
      { mode: 0o755 }
    );
    const restore = overrideEnv({ ANTHROPIC_API_KEY: 'sk-server', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-server' });
    try {
      const accounts = brittle(world, {
        run: runCommand,
        resolveClaude: () => Promise.resolve(claude),
        readSecret: () => Promise.resolve(null),
      });
      const account = accounts.store.create('login');
      await accounts.syncSignIns();
      await accounts.remove(account.id);
    } finally {
      restore();
    }
    expect(readFileSync(seen, 'utf8').split('\n')).toEqual([
      'status none:none',
      'logout none:none',
      'status sk-server:oauth-server',
      '',
    ]);
  });

  test('the user’s own claude is found on the PATH, and a missing one is named', async () => {
    const world = createWorld({ registry: true });
    const accounts = brittle(world, { resolveClaude: undefined, readSecret: () => Promise.resolve(null) });
    const found = await accounts.startLogin(null);
    expect(found.login?.phase).toBe('starting');
    accounts.stop();
    const path = Bun.env.PATH;
    Bun.env.PATH = '/nonexistent';
    try {
      await expect(accounts.startLogin(null)).rejects.toThrow('Claude Code is not installed.');
    } finally {
      Bun.env.PATH = path;
    }
  });
});

describe('the accounts snapshot', () => {
  test('an account with a window used up reads as spent until it resets, before any run is rejected', async () => {
    const world = createWorld({ registry: true });
    await addAccount(world, 'full@example.com', 100);
    await world.accounts.refresh();
    expect(world.accounts.snapshot().accounts[0]?.spentUntil).toBe(Date.parse('2030-01-01T00:00:00Z'));
  });
});

const CODEX_LOGIN: ProviderLogin = {
  provider: 'codex',
  label: 'Codex',
  status: 'signed_in',
  method: 'ChatGPT',
  version: '0.159.0',
  detail: null,
  fix: null,
};

function createCodexSource(readings: ProviderUsageReading[]) {
  let index = 0;
  const source: ProviderUsageSource = {
    id: 'codex',
    read: () => {
      const reading = readings[Math.min(index, readings.length - 1)] as ProviderUsageReading;
      index += 1;
      return Promise.resolve(reading);
    },
  };
  return { source, count: () => index };
}

function codexReading(weekly: number, patch: Partial<ProviderUsageReading> = {}): ProviderUsageReading {
  return {
    read: {
      ok: true,
      windows: [
        {
          id: 'five_hour',
          kind: 'session',
          label: '5-hour limit',
          model: null,
          usedPercent: 10,
          resetsAt: 2_000_000,
        },
        {
          id: 'seven_day',
          kind: 'weekly',
          label: 'Weekly limit',
          model: null,
          usedPercent: weekly,
          resetsAt: 9_000_000,
        },
      ],
      fastMode: 'needs_credits',
    },
    email: 'codex@example.com',
    plan: 'plus',
    ...patch,
  };
}

describe('a provider with a sign-in of its own (Codex)', () => {
  test('its usage, email and plan ride along with its sign-in in the snapshot', async () => {
    const codex = createCodexSource([codexReading(40)]);
    const world = createWorld({
      registry: true,
      providerUsage: [codex.source],
      providerLogins: () =>
        Promise.resolve([CODEX_LOGIN, { ...CODEX_LOGIN, provider: 'other', label: 'Other' }]),
    });
    await world.accounts.refresh();
    const [login, other] = world.accounts.snapshot().providers ?? [];
    expect(login).toMatchObject({
      provider: 'codex',
      email: 'codex@example.com',
      plan: 'plus',
      usage: { status: 'ok', fastMode: 'needs_credits', source: 'read' },
    });
    expect(login?.usage?.windows.map((window) => window.usedPercent)).toEqual([10, 40]);
    expect(other).toEqual({ ...CODEX_LOGIN, provider: 'other', label: 'Other' });
  });

  test('a failed read keeps what was read before, email and plan included', async () => {
    const failed: ProviderUsageReading = {
      read: { ok: false, reason: 'failed', detail: 'Codex answered 500.', retryAfterMs: null },
      email: null,
      plan: null,
    };
    const codex = createCodexSource([codexReading(40), failed]);
    const world = createWorld({
      registry: true,
      providerUsage: [codex.source],
      providerLogins: () => Promise.resolve([CODEX_LOGIN]),
    });
    await world.accounts.refresh();
    await world.accounts.refresh();
    expect(world.accounts.snapshot().providers?.[0]).toMatchObject({
      email: 'codex@example.com',
      plan: 'plus',
      usage: { detail: 'Codex answered 500.', fastMode: 'needs_credits' },
    });
  });

  test('a run on it starts from the cached weekly reading and ends on a fresh one; an unknown provider reads nothing', async () => {
    const codex = createCodexSource([codexReading(40), codexReading(45)]);
    const world = createWorld({ registry: true, providerUsage: [codex.source] });
    expect(await world.accounts.readProviderWeeklyReading('codex', false)).toMatchObject({ percent: 40 });
    expect(await world.accounts.readProviderWeeklyReading('codex', false)).toMatchObject({ percent: 40 });
    expect(await world.accounts.readProviderWeeklyReading('codex', true)).toMatchObject({ percent: 45 });
    expect(await world.accounts.readProviderWeeklyReading('gemini', true)).toBeNull();
  });

  test('fast mode is read from the provider, or from the Claude account a run leases', async () => {
    const codex = createCodexSource([
      codexReading(40, { read: { ok: true, windows: [], fastMode: 'available' } }),
    ]);
    const world = createWorld({ registry: true, providerUsage: [codex.source] });
    expect(await world.accounts.readFastMode('codex', null)).toBe('available');
    expect(await world.accounts.readFastMode('gemini', null)).toBe('unknown');
    expect(await world.accounts.readFastMode('claude', null)).toBe('unknown');
    const account = await addAccount(world, 'a@example.com', 10);
    world.advance(2 * 60_000);
    world.usage.set('token-a@example.com', {
      ...windows(10, 10),
      extra_usage: { is_enabled: true, monthly_limit: 50, used_credits: 5 },
    });
    expect(await world.accounts.readFastMode('claude', account.id)).toBe('available');
    world.usage.set('token-a@example.com', { ...windows(10, 10), extra_usage: { is_enabled: false } });
    world.advance(2 * 60_000);
    expect(await world.accounts.readFastMode('claude', account.id)).toBe('needs_credits');
  });

  test('a quick call on your own Claude Code login asks that login, and an account Shinsa has not read is unknown', async () => {
    const world = createWorld();
    world.statuses.set('default', { loggedIn: true, email: 'me@example.com', subscriptionType: 'max' });
    world.login(null, 'token-me');
    world.usage.set('token-me', { ...windows(10, 10), extra_usage: null });
    await world.accounts.start();
    world.accounts.stop();
    expect(await world.accounts.readFastMode('claude', null)).toBe('needs_credits');
    expect(await world.accounts.readQuickFastMode('claude')).toBe('needs_credits');
    world.usage.set('token-me', windows(10, 10));
    world.advance(2 * 60_000);
    expect(await world.accounts.readFastMode('claude', null)).toBe('unknown');
  });

  test('its usage limit waits for the reset it reported, or for the one its windows show', async () => {
    const codex = createCodexSource([
      codexReading(100, {
        read: {
          ok: true,
          windows: [
            {
              id: 'seven_day',
              kind: 'weekly',
              label: 'Weekly limit',
              model: null,
              usedPercent: 100,
              resetsAt: 9_000_000,
            },
          ],
        },
      }),
    ]);
    const world = createWorld({ registry: true, providerUsage: [codex.source] });
    world.stub.update((state) => {
      state.runs['run-1'] = createRun({ model: 'gpt-6-astra' });
    });
    const rejection = (overrides: Partial<RunFailure>): RunRejection => ({
      runId: 'run-1',
      taskId: 'task-1',
      provider: 'codex',
      attemptId: 'attempt-1',
      accountId: null,
      tried: [],
      failure: failure(overrides),
    });
    expect(await world.accounts.onRejection(rejection({ resetAt: 5_000_000 }))).toEqual({ retry: false });
    expect(await world.accounts.onRejection(rejection({ resetAt: null }))).toEqual({
      retry: false,
      failure: failure({ resetAt: 9_000_000 }),
    });
    expect(await world.accounts.onRejection(rejection({ class: 'overloaded' }))).toEqual({ retry: false });
  });

  test('its usage limit waits for the reset Codex pushed during the run, before reading its usage again', async () => {
    const codex = createCodexSource([codexReading(10)]);
    const world = createWorld({ registry: true, providerUsage: [codex.source] });
    world.stub.update((state) => {
      state.runs['run-1'] = createRun({
        attempts: [
          {
            attemptId: 'run-1:1',
            startedAt: 1,
            provider: 'codex',
            model: null,
            resumed: false,
            handoff: null,
            account: null,
          },
        ],
      });
    });
    world.accounts.onNotice('run-1', {
      kind: 'rate_limit',
      status: 'rejected',
      limit: 'five_hour',
      resetsAt: 9_500_000,
      utilization: 1,
    });
    const verdict = await world.accounts.onRejection({
      runId: 'run-1',
      taskId: 'task-1',
      provider: 'codex',
      attemptId: 'run-1:1',
      accountId: null,
      tried: [],
      failure: failure({ resetAt: null }),
    });
    expect(verdict).toEqual({ retry: false, failure: failure({ resetAt: 9_500_000 }) });
  });

  test('signed out, it asks for its own sign-in, and signing in answers that provider’s Sign in gate, not a Claude account’s', async () => {
    let logins: ProviderLogin[] = [{ ...CODEX_LOGIN, status: 'signed_out' }];
    const codex = createCodexSource([codexReading(10)]);
    const world = createWorld({
      registry: true,
      providerUsage: [codex.source],
      providerLogins: () => Promise.resolve(logins),
    });
    await world.accounts.refresh();
    const verdict = await world.accounts.onRejection({
      runId: 'run-1',
      taskId: 'task-1',
      provider: 'codex',
      attemptId: 'attempt-1',
      accountId: null,
      tried: [],
      failure: failure({ class: 'auth', retryable: false }),
    });
    expect(verdict).toEqual({
      retry: false,
      failure: failure({
        class: 'auth',
        retryable: false,
        login: { provider: 'codex', email: 'codex@example.com' },
      }),
    });
    world.stub.update((state) => {
      state.tasks['task-1'] = createTask();
      state.gates['gate-1'] = createGate({
        id: 'gate-1',
        taskId: 'task-1',
        type: 'sign_in',
        provider: 'codex',
        account: null,
      });
      state.gates['gate-2'] = createGate({
        id: 'gate-2',
        taskId: 'task-1',
        type: 'sign_in',
        provider: 'claude',
        account: { id: 'acct-1', email: 'ada@example.com' },
      });
    });
    await world.accounts.syncProviderLogins();
    expect(
      world.stub.dispatched.filter((command) => command.type === 'provider.record_sign_in')
    ).toHaveLength(0);
    logins = [CODEX_LOGIN];
    await world.accounts.syncProviderLogins();
    expect(world.stub.dispatched.filter((command) => command.type === 'provider.record_sign_in')).toEqual([
      { type: 'provider.record_sign_in', provider: 'codex' },
    ]);
    expect(world.stub.dispatched.some((command) => command.type === 'account.signed_in')).toBe(false);
    expect(world.stub.commandIds.at(-1)).toBe('provider-login:codex:gate-1');
  });

  test('a sign-in that cannot be carried on is logged, and a failed sign-in check keeps the last one', async () => {
    let fail = false;
    const world = createWorld({
      registry: true,
      providerLogins: () =>
        fail ? Promise.reject(new Error('codex vanished')) : Promise.resolve([CODEX_LOGIN]),
    });
    world.stub.update((state) => {
      state.tasks['task-1'] = createTask();
      state.gates['gate-1'] = createGate({
        id: 'gate-1',
        taskId: 'task-1',
        type: 'sign_in',
        provider: 'codex',
        account: null,
      });
    });
    world.stub.reject((command) => command.type === 'provider.record_sign_in');
    const warn = spyOn(log, 'warn');
    try {
      await world.accounts.syncProviderLogins();
      fail = true;
      await world.accounts.syncProviderLogins();
      expect(warn.mock.calls.map((call) => call[0])).toEqual([
        '[Accounts] Could not carry on after a provider sign-in',
        '[Accounts] Could not check the other providers’ sign-ins',
        '[Accounts] Could not carry on after a provider sign-in',
      ]);
    } finally {
      warn.mockRestore();
    }
    expect(world.accounts.snapshot().providers).toEqual([CODEX_LOGIN]);
  });

  test('a pushed rate limit from a Codex run lands on Codex, and one from an unknown provider is dropped', async () => {
    const codex = createCodexSource([codexReading(10)]);
    const world = createWorld({
      registry: true,
      providerUsage: [codex.source],
      providerLogins: () => Promise.resolve([CODEX_LOGIN]),
    });
    await world.accounts.refresh();
    world.stub.update((state) => {
      state.runs['run-1'] = createRun({
        attempts: [
          {
            attemptId: 'run-1:1',
            startedAt: 1,
            provider: 'codex',
            model: null,
            resumed: false,
            handoff: null,
            account: null,
          },
        ],
      });
      state.runs['run-2'] = createRun({
        id: 'run-2',
        attempts: [
          {
            attemptId: 'run-2:1',
            startedAt: 1,
            provider: 'gemini',
            model: null,
            resumed: false,
            handoff: null,
            account: null,
          },
        ],
      });
    });
    const notice = {
      kind: 'rate_limit',
      status: 'rejected',
      limit: 'seven_day',
      resetsAt: 9_500_000,
      utilization: 1,
    } as const;
    world.accounts.onNotice('run-1', notice);
    world.accounts.onNotice('run-2', notice);
    world.accounts.onNotice('run-1', { kind: 'interrupted' });
    expect(
      world.accounts.snapshot().providers?.[0]?.usage?.windows.find((window) => window.id === 'seven_day')
    ).toMatchObject({
      usedPercent: 100,
      resetsAt: 9_500_000,
    });
  });
});
