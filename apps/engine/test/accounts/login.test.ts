import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountLogin } from '@shinsa/core';
import { Effect, Exit, Scope } from 'effect';
import { AccountChanges } from '../../src/accounts/changes/service.ts';
import {
  LoginFinishFailed,
  type LoginOutcome,
  type LoginStart,
  type LoginTimers,
} from '../../src/accounts/login/schema.ts';
import { AccountLogins } from '../../src/accounts/login/service.ts';
import { parseLoginUrl } from '../../src/accounts/login/transcript.ts';
import { describeError } from '../../src/log/redact.ts';
import { captureLogs, createTempDir, until } from '../helpers/index.ts';
import {
  type AccountsHarness,
  type AccountsHarnessOptions,
  buildUnitAccounts,
  type FakeLoginOptions,
  type FakeLoginSpawner,
} from './harness.ts';

const URL = 'https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz';

const KEYCHAIN_HINT =
  'On a Mac the keychain may need your approval the first time. Run `claude auth login` in a terminal once, then try again.';

const QUIET = { menuFallbackMs: 60_000, urlTimeoutMs: 60_000, watchdogMs: 60_000 };

type LoginRequest = Omit<LoginStart, 'finish' | 'ended'>;

const START: LoginRequest = {
  accountId: 'acc-1',
  claude: '/bin/claude',
  cwd: '/home/me',
  env: { CLAUDE_CONFIG_DIR: '/acc/acc-1' },
  email: 'old@x.dev',
};

interface FakeProcess {
  command: string[];
  options: FakeLoginOptions;
  writes: string[];
  kills: number;
  exit: ReturnType<typeof Promise.withResolvers<number>>;
  print: (text: string) => void;
}

interface HarnessPatch {
  timers?: LoginTimers;
  finish?: (accountId: string, loginId: string) => Promise<LoginOutcome>;
  spawn?: FakeLoginSpawner;
  harness?: Partial<AccountsHarnessOptions>;
}

const open: AccountsHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function createHarness(patch: HarnessPatch = {}) {
  const processes: FakeProcess[] = [];
  const ended: AccountLogin[] = [];
  let changes = 0;
  const finish = patch.finish ?? (() => Promise.resolve<LoginOutcome>({ ok: true, email: 'new@x.dev' }));
  const spawn: FakeLoginSpawner =
    patch.spawn ??
    ((command, options) => {
      const process: FakeProcess = {
        command,
        options,
        writes: [],
        kills: 0,
        exit: Promise.withResolvers<number>(),
        print: (text) => options.onData(text),
      };
      processes.push(process);
      return {
        write: (data) => process.writes.push(data),
        kill: () => {
          process.kills++;
        },
        exited: process.exit.promise,
      };
    });
  const harness = await buildUnitAccounts({
    spawnLogin: spawn,
    loginTimers: patch.timers ?? QUIET,
    now: 42,
    ...patch.harness,
  });
  open.push(harness);
  const service = harness.service(AccountLogins);
  const listening = harness.runSync(Scope.make());
  harness.runSync(
    harness
      .service(AccountChanges)
      .listen(
        Effect.sync(() => {
          changes++;
        })
      )
      .pipe(Scope.provide(listening))
  );
  const sync = harness.runSync;
  const logins = {
    start: (request: LoginRequest) =>
      sync(
        service.start({
          ...request,
          finish: (loginId) =>
            Effect.tryPromise({
              try: () => finish(request.accountId, loginId),
              catch: (error) => new LoginFinishFailed({ message: describeError(error) }),
            }),
          ended: (login) => Effect.sync(() => ended.push(login)),
        })
      ),
    current: () => sync(service.current),
    submitCode: (loginId: string, code: string) => sync(service.submitCode(loginId, code)),
    cancel: (loginId: string) => sync(service.cancel(loginId)),
    clear: (loginId: string) => sync(service.clear(loginId)),
    stop: () => sync(service.stop),
  };
  const current = () => logins.current() as AccountLogin;
  const process = (index = 0) => processes[index] as FakeProcess;
  return {
    logins,
    processes,
    process,
    ended,
    current,
    changes: () => changes,
    adjust: harness.adjust,
    close: () => sync(Scope.close(listening, Exit.void)),
  };
}

describe('sign-in link', () => {
  test('is read from a terminal hyperlink ended by BEL or ST', async () => {
    expect(parseLoginUrl(`Open \u001b]8;;${URL}\u0007this link\u001b]8;;\u0007`)).toBe(URL);
    expect(parseLoginUrl(`\u001b]8;id=1;${URL}\u001b\\here\u001b]8;;\u001b\\`)).toBe(URL);
  });

  test('is read from plain text with colours and cursor moves around it', async () => {
    const output = `\u001b[2J\u001b[?25lBrowser didn't open? Use the url below:\r\n\u001b[1m\u001b[36m${URL}\u001b[0m\r\n`;
    expect(parseLoginUrl(output)).toBe(URL);
  });

  test('ignores links that are not the OAuth authorize page', async () => {
    expect(
      parseLoginUrl('See https://docs.anthropic.com/claude-code and https://claude.ai/login')
    ).toBeNull();
    expect(parseLoginUrl('')).toBeNull();
  });
});

describe('account logins', () => {
  test('starting runs claude auth login for claude.ai in the account’s folder', async () => {
    const { logins, process, changes } = await createHarness();
    const login = logins.start(START);
    expect(login).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      accountId: 'acc-1',
      email: 'old@x.dev',
      phase: 'starting',
      url: null,
      message: null,
      startedAt: 42,
    });
    expect(process().command).toEqual(['/bin/claude', 'auth', 'login', '--claudeai']);
    expect(process().options).toMatchObject({ cwd: '/home/me', env: { CLAUDE_CONFIG_DIR: '/acc/acc-1' } });
    expect(changes()).toBe(1);
    logins.stop();
  });

  test('the link Claude prints moves the sign-in to waiting with the link', async () => {
    const { logins, process, current } = await createHarness();
    logins.start(START);
    process().print('Opening browser…\r\n');
    expect(current().phase).toBe('starting');
    process().print(`\u001b[36m${URL.slice(0, 30)}`);
    process().print(`${URL.slice(30)}\u001b[0m\r\n`);
    expect(current()).toMatchObject({ phase: 'waiting', url: URL });
    process().print('https://claude.ai/oauth/authorize?other=1\r\n');
    expect(current().url).toBe(URL);
    logins.stop();
  });

  test('when Claude shows its login menu instead of a link, Enter picks the default choice', async () => {
    const { logins, process, adjust } = await createHarness({ timers: { ...QUIET, menuFallbackMs: 5 } });
    logins.start(START);
    await adjust(5);
    await until('the menu choice', () => process().writes.includes('\r'));
    expect(process().writes).toEqual(['\r']);
    logins.stop();
  });

  test('the menu fallback does nothing once the link is shown', async () => {
    const { logins, process, adjust } = await createHarness({
      timers: { ...QUIET, menuFallbackMs: 5, watchdogMs: 30 },
    });
    logins.start(START);
    process().print(URL);
    await adjust(30);
    await until('the watchdog', () => logins.current()?.phase === 'failed');
    expect(process().writes).toEqual([]);
  });

  test('no link in time fails with the last thing Claude printed and the keychain hint', async () => {
    const { logins, process, current, ended, adjust } = await createHarness({
      timers: { ...QUIET, urlTimeoutMs: 5 },
    });
    logins.start(START);
    process().print('\u001b[31mError: keychain locked\u001b[0m\r\n\r\n');
    await adjust(5);
    await until('the timeout', () => current().phase === 'failed');
    expect(current().message).toBe(
      `Claude did not show a sign-in link (Error: keychain locked). ${KEYCHAIN_HINT}`
    );
    expect(process().kills).toBe(1);
    expect(ended).toEqual([current()]);
  });

  test('no output at all says it printed nothing', async () => {
    const { logins, current, adjust } = await createHarness({ timers: { ...QUIET, urlTimeoutMs: 5 } });
    logins.start(START);
    await adjust(5);
    await until('the timeout', () => current().phase === 'failed');
    expect(current().message).toBe(
      `Claude did not show a sign-in link (it printed nothing). ${KEYCHAIN_HINT}`
    );
  });

  test('the link timeout does nothing once the link is shown', async () => {
    const { logins, process, current, adjust } = await createHarness({
      timers: { ...QUIET, urlTimeoutMs: 5, watchdogMs: 30 },
    });
    logins.start(START);
    process().print(URL);
    await adjust(30);
    await until('the watchdog', () => current().phase === 'failed');
    expect(current().message).toBe('The sign-in took too long, so Shinsa stopped it.');
  });

  test('the code is typed into Claude with Enter and the sign-in moves to finishing', async () => {
    const { logins, process, current } = await createHarness();
    const { id } = logins.start(START);
    expect(logins.submitCode(id, 'early')).toBe(false);
    process().print(URL);
    expect(logins.submitCode('other', 'abc#def')).toBe(false);
    expect(logins.submitCode(id, '  abc#def \n')).toBe(true);
    expect(process().writes).toEqual(['abc#def\r']);
    expect(current().phase).toBe('finishing');
    expect(logins.submitCode(id, 'again')).toBe(false);
    logins.stop();
  });

  test('Claude exiting after the code finishes the sign-in with the account’s email', async () => {
    const { logins, process, current, ended } = await createHarness();
    const { id } = logins.start(START);
    process().print(URL);
    logins.submitCode(id, 'code');
    process().exit.resolve(0);
    await until('done', () => current().phase === 'done');
    expect(current()).toMatchObject({ phase: 'done', email: 'new@x.dev', message: null, url: URL });
    expect(ended).toHaveLength(1);
    expect(process().kills).toBe(1);
  });

  test('a successful exit without a typed code also finishes, keeping the known email when none is found', async () => {
    const finished: string[] = [];
    const { logins, process, current } = await createHarness({
      finish: (accountId) => {
        finished.push(accountId);
        return Promise.resolve({ ok: true, email: null });
      },
    });
    logins.start(START);
    process().exit.resolve(0);
    await until('done', () => current().phase === 'done');
    expect(current().email).toBe('old@x.dev');
    expect(finished).toEqual(['acc-1']);
  });

  test('a code Claude rejects with a non-zero exit is still checked', async () => {
    const { logins, process, current } = await createHarness({
      finish: () => Promise.resolve({ ok: false, message: 'Claude does not have a login for this account.' }),
    });
    const { id } = logins.start(START);
    process().print(URL);
    logins.submitCode(id, 'wrong');
    process().exit.resolve(1);
    await until('failed', () => current().phase === 'failed');
    expect(current().message).toBe('Claude does not have a login for this account.');
  });

  test('a check that throws fails the sign-in and is logged', async () => {
    const logs = captureLogs();
    try {
      const { logins, process, current } = await createHarness({
        finish: () => Promise.reject(new Error('keychain timed out')),
      });
      logins.start(START);
      process().exit.resolve(0);
      await until('failed', () => current().phase === 'failed');
      expect(current().message).toBe('Shinsa could not check the sign-in: keychain timed out');
      expect(logs.fieldsOf('[Accounts] Could not check the account after signing in')).toEqual([
        { accountId: 'acc-1', error: 'keychain timed out' },
      ]);
    } finally {
      logs.restore();
    }
  });

  test('Claude ending on its own without a code fails with its last line', async () => {
    const { logins, process, current } = await createHarness();
    logins.start(START);
    process().print('Login failed: network unreachable\n');
    process().exit.resolve(1);
    await until('failed', () => current().phase === 'failed');
    expect(current().message).toBe('Claude ended the sign-in (Login failed: network unreachable).');
  });

  test('a process that cannot report its exit fails with the reason', async () => {
    const { logins, process, current } = await createHarness();
    logins.start(START);
    process().exit.reject(new Error('pty closed'));
    await until('failed', () => current().phase === 'failed');
    expect(current().message).toBe('pty closed');
  });

  test('cancelling stops Claude and says you cancelled; clearing then forgets the sign-in', async () => {
    const { logins, process, current, ended, changes } = await createHarness();
    const { id } = logins.start(START);
    expect(logins.cancel('other')).toBe(false);
    logins.clear(id);
    expect(logins.current()).not.toBeNull();
    expect(logins.cancel(id)).toBe(true);
    expect(current()).toMatchObject({ phase: 'failed', message: 'You cancelled the sign-in.' });
    expect(process().kills).toBe(1);
    expect(logins.cancel(id)).toBe(true);
    expect(ended).toHaveLength(1);
    const before = changes();
    logins.clear('other');
    expect(changes()).toBe(before);
    logins.clear(id);
    expect(logins.current()).toBeNull();
    expect(changes()).toBe(before + 1);
  });

  test('a finished sign-in can be cleared', async () => {
    const { logins, process, current } = await createHarness();
    const { id } = logins.start(START);
    process().exit.resolve(0);
    await until('done', () => current().phase === 'done');
    logins.clear(id);
    expect(logins.current()).toBeNull();
  });

  test('starting a second sign-in ends the first, whose later exit changes nothing', async () => {
    const { logins, process, current, ended } = await createHarness();
    const first = logins.start(START);
    const second = logins.start({ ...START, accountId: 'acc-2', email: null });
    expect(ended).toEqual([
      expect.objectContaining({ id: first.id, phase: 'failed', message: 'Another sign-in started.' }),
    ]);
    expect(process(0).kills).toBe(1);
    expect(second).toMatchObject({ accountId: 'acc-2', phase: 'starting' });
    expect(second.id).not.toBe(first.id);
    process(0).print(URL);
    process(0).exit.resolve(0);
    await process(0).exit.promise;
    expect(current()).toMatchObject({ id: second.id, phase: 'starting', url: null });
    logins.stop();
  });

  test('a later exit of an ended sign-in is ignored', async () => {
    const { logins, process, current, ended } = await createHarness();
    const { id } = logins.start(START);
    logins.cancel(id);
    process().exit.resolve(0);
    await process().exit.promise;
    expect(current().phase).toBe('failed');
    expect(ended).toHaveLength(1);
  });

  test('a claude that cannot start fails at once with the reason', async () => {
    const { logins, ended } = await createHarness({
      spawn: () => {
        throw new Error('ENOENT: claude not found');
      },
    });
    const login = logins.start(START);
    expect(login).toMatchObject({
      phase: 'failed',
      message: 'Claude could not start the sign-in: ENOENT: claude not found',
    });
    expect(logins.submitCode(login.id, 'code')).toBe(false);
    expect(ended).toHaveLength(1);
  });

  test('the watchdog stops a sign-in left open too long', async () => {
    const { logins, process, current, adjust } = await createHarness({ timers: { ...QUIET, watchdogMs: 5 } });
    logins.start(START);
    process().print(URL);
    await adjust(5);
    await until('the watchdog', () => current().phase === 'failed');
    expect(current().message).toBe('The sign-in took too long, so Shinsa stopped it.');
    expect(process().kills).toBe(1);
  });

  test('stopping Shinsa ends an open sign-in, and does nothing without one', async () => {
    const { logins, current } = await createHarness();
    logins.stop();
    expect(logins.current()).toBeNull();
    logins.start(START);
    logins.stop();
    expect(current()).toMatchObject({ phase: 'failed', message: 'Shinsa stopped.' });
  });

  test('the sign-in timers have working defaults', async () => {
    const { logins, adjust, current } = await createHarness({ harness: { loginTimers: undefined } });
    logins.start(START);
    await adjust(16 * 60_000);
    await until('the watchdog', () => current().phase === 'failed');
    expect(current().message).toBe(
      `Claude did not show a sign-in link (it printed nothing). ${KEYCHAIN_HINT}`
    );
  });
});

describe('login terminal', () => {
  test('runs claude in a terminal: its output arrives, the code reaches it and its exit finishes the sign-in', async () => {
    const dir = createTempDir();
    const claude = join(dir, 'claude');
    writeFileSync(
      claude,
      `#!/bin/sh\nprintf "ready:$SHINSA_PROBE:$TERM:[%s]\\n${URL}\\n" "$SHINSA_CLEARED"\nread line\nprintf "got:%s\\n" "$line"\n`
    );
    chmodSync(claude, 0o755);
    const { logins, current } = await createHarness({
      harness: {
        realTerminals: true,
        liveClock: true,
        now: undefined,
        env: { SHINSA_PROBE: 'probe', SHINSA_CLEARED: 'kept' },
      },
    });
    const login = logins.start({ ...START, claude, cwd: dir, env: { SHINSA_CLEARED: undefined } });
    await until('the link', () => current().phase === 'waiting');
    expect(logins.submitCode(login.id, 'hello')).toBe(true);
    await until('done', () => current().phase === 'done');
    expect(current().email).toBe('new@x.dev');
  });

  test('cancelling hangs the terminal up', async () => {
    const dir = createTempDir();
    const claude = join(dir, 'claude');
    writeFileSync(claude, '#!/bin/sh\nsleep 30\n');
    chmodSync(claude, 0o755);
    const { logins, current } = await createHarness({
      harness: { realTerminals: true, liveClock: true, now: undefined },
    });
    const login = logins.start({ ...START, claude, cwd: dir });
    expect(logins.cancel(login.id)).toBe(true);
    expect(current().message).toBe('You cancelled the sign-in.');
  });
});
