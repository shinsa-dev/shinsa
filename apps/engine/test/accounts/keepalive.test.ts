import { afterEach, describe, expect, test } from 'bun:test';
import { KEEPALIVE_ARGS, KEEPALIVE_SIGNED_OUT_DETAIL } from '../../src/accounts/keepalive/schema.ts';
import { LoginKeepalive } from '../../src/accounts/keepalive/service.ts';
import { resolveKeychainService } from '../../src/accounts/paths.ts';
import type { StoredAccount } from '../../src/accounts/schema.ts';
import type { CommandResult } from '../../src/shell/schema.ts';
import { createTempDir, createTestConfig } from '../helpers/index.ts';
import { type AccountsHarness, buildUnitAccounts, type FakeCommandOptions } from './harness.ts';

const open: AccountsHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

const NOW = 10_000_000;

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const DIR = '/accounts/acc-1';

const ACCOUNT: StoredAccount = {
  id: 'acc-1',
  configDir: DIR,
  email: 'a@example.com',
  organization: null,
  plan: 'max',
  origin: 'login',
  owner: null,
  addedAt: 1,
  paused: false,
  switchAt: null,
};

function answer(stdout: string, overrides: Partial<CommandResult> = {}): CommandResult {
  return { ok: true, code: 0, stdout, stderr: '', timedOut: false, ...overrides };
}

const OK = answer(JSON.stringify({ is_error: false, result: 'ok', api_error_status: null }));

interface Turn {
  command: string[];
  cwd: string;
  options: FakeCommandOptions;
}

async function createKeepalive() {
  const secrets = new Map<string, string>();
  const turns: Turn[] = [];
  const world = {
    turns,
    respond: (): CommandResult | Promise<CommandResult> => OK,
    store: (expiresAt: number | null, dir: string = DIR) =>
      secrets.set(
        resolveKeychainService(dir),
        JSON.stringify({ claudeAiOauth: { accessToken: 'token', refreshToken: 'refresh', expiresAt } })
      ),
    refresh: () => {
      world.respond = () => {
        world.store(NOW + 8 * HOUR);
        return OK;
      };
    },
  };
  const harness = await buildUnitAccounts({
    env: { USER: 'me' },
    config: { ...createTestConfig(createTempDir()), userHome: '/nowhere' },
    readSecret: (service) => Promise.resolve(secrets.get(service) ?? null),
    run: (command, cwd, options) => {
      turns.push({ command, cwd, options });
      return Promise.resolve(world.respond());
    },
    now: NOW,
  });
  open.push(harness);
  const service = harness.service(LoginKeepalive);
  const keep = (overrides: { account?: StoredAccount; readExpired?: boolean; force?: boolean } = {}) =>
    harness.run(
      service.keep({ account: ACCOUNT, claude: 'claude', readExpired: false, force: false, ...overrides })
    );
  return { ...world, world, harness, keep, clear: () => harness.run(service.clear(ACCOUNT.id)) };
}

describe('which logins get a turn', () => {
  test('only a login of Shinsa’s own that is stored and expires soon, or that Claude refused', async () => {
    const { keep, store, turns, world } = await createKeepalive();
    expect(await keep()).toEqual({ kind: 'idle' });
    store(NOW + HOUR);
    expect(await keep()).toEqual({ kind: 'idle' });
    store(NOW + 5 * MINUTE);
    expect(await keep({ account: { ...ACCOUNT, origin: 'cswap' } })).toEqual({ kind: 'idle' });
    expect(await keep({ account: { ...ACCOUNT, configDir: null } })).toEqual({ kind: 'idle' });
    expect(turns).toEqual([]);
    world.refresh();
    expect(await keep()).toEqual({ kind: 'refreshed' });
    expect(await keep({ readExpired: true, force: true })).toEqual({ kind: 'refreshed' });
    store(null);
    expect(await keep({ force: true })).toEqual({ kind: 'idle' });
    expect(turns).toHaveLength(2);
  });

  test('the turn is one Haiku prompt without tools, in the account’s folder and environment', async () => {
    const { keep, store, turns } = await createKeepalive();
    store(NOW - HOUR);
    await keep();
    expect(turns).toHaveLength(1);
    expect(turns[0]?.command).toEqual(['claude', ...KEEPALIVE_ARGS]);
    expect(turns[0]?.command).toEqual(
      expect.arrayContaining([
        '-p',
        '--model',
        'haiku',
        '--output-format',
        'json',
        '--no-session-persistence',
      ])
    );
    expect(turns[0]?.cwd).toBe(DIR);
    expect(turns[0]?.options.env?.CLAUDE_CONFIG_DIR).toBe(DIR);
    expect(turns[0]?.options.timeoutMs).toBe(60_000);
  });
});

describe('what a turn says about the login', () => {
  test('a login that is still expired afterwards, or a turn that timed out, failed', async () => {
    const { keep, store, world } = await createKeepalive();
    store(NOW - HOUR);
    expect(await keep()).toEqual({ kind: 'failed' });
    world.respond = () => {
      store(NOW + HOUR);
      return answer('', { ok: false, timedOut: true });
    };
    expect(await keep({ force: true })).toEqual({ kind: 'failed' });
  });

  test('an account out of usage still counts as refreshed', async () => {
    const { keep, store, world } = await createKeepalive();
    store(NOW - HOUR);
    world.respond = () => {
      store(NOW + HOUR);
      return answer(JSON.stringify({ is_error: true, result: 'You hit your limit', api_error_status: 429 }), {
        ok: false,
        code: 1,
      });
    };
    expect(await keep()).toEqual({ kind: 'refreshed' });
  });

  test.each([
    ['a 401 from the API', answer(JSON.stringify({ is_error: true, api_error_status: 401 }))],
    [
      'an error result asking to log in',
      answer(JSON.stringify({ is_error: true, result: 'Please run /login' })),
    ],
    ['plain text saying it is not logged in', answer('', { ok: false, code: 1, stderr: 'Not logged in' })],
  ])('%s means the account is signed out', async (_name, refused) => {
    const { keep, store, world } = await createKeepalive();
    store(NOW - HOUR);
    world.respond = () => refused;
    expect(await keep()).toEqual({ kind: 'signed_out', detail: KEEPALIVE_SIGNED_OUT_DETAIL });
  });

  test('a reply that only mentions logging in is not a refusal', async () => {
    const { keep, store, world } = await createKeepalive();
    store(NOW - HOUR);
    world.respond = () => {
      store(NOW + HOUR);
      return answer(JSON.stringify({ result: 'Please run /login' }));
    };
    expect(await keep()).toEqual({ kind: 'refreshed' });
  });
});

describe('how often a login is tried', () => {
  test('once per half hour unless forced, and again at once after its last try is cleared', async () => {
    const { keep, clear, store, turns, harness } = await createKeepalive();
    store(NOW - HOUR);
    await keep();
    expect(await keep()).toEqual({ kind: 'idle' });
    await harness.setTime(NOW + 29 * MINUTE);
    expect(await keep()).toEqual({ kind: 'idle' });
    expect(turns).toHaveLength(1);
    await keep({ force: true });
    expect(turns).toHaveLength(2);
    await harness.setTime(NOW + 60 * MINUTE);
    await keep();
    expect(turns).toHaveLength(3);
    await clear();
    await keep();
    expect(turns).toHaveLength(4);
  });

  test('one turn at a time per account', async () => {
    const { keep, store, turns, world } = await createKeepalive();
    store(NOW - HOUR);
    const gate = Promise.withResolvers<CommandResult>();
    world.respond = () => gate.promise;
    const first = keep({ force: true });
    const second = keep({ force: true });
    expect(await second).toEqual({ kind: 'idle' });
    gate.resolve(OK);
    expect(await first).toEqual({ kind: 'failed' });
    expect(turns).toHaveLength(1);
  });
});
