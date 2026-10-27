import { describe, expect, spyOn, test } from 'bun:test';
import type { AccountLogin } from '@shinsa/core';
import {
  AccountLogins,
  type AccountLoginsOptions,
  type LoginFinisher,
  type LoginSpawnOptions,
  type LoginStart,
  parseLoginUrl,
  spawnLoginTerminal,
} from '../../src/accounts/login.ts';
import { log } from '../../src/log/index.ts';
import { overrideEnv, until } from '../helpers/index.ts';

const URL = 'https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz';

const KEYCHAIN_HINT =
  'On a Mac the keychain may need your approval the first time. Run `claude auth login` in a terminal once, then try again.';

const QUIET = { menuFallbackMs: 60_000, urlTimeoutMs: 60_000, watchdogMs: 60_000 };

const START: LoginStart = {
  accountId: 'acc-1',
  claude: '/bin/claude',
  cwd: '/home/me',
  env: { CLAUDE_CONFIG_DIR: '/acc/acc-1' },
  email: 'old@x.dev',
};

interface FakeProcess {
  command: string[];
  options: LoginSpawnOptions;
  writes: string[];
  kills: number;
  exit: ReturnType<typeof Promise.withResolvers<number>>;
  print: (text: string) => void;
}

function createHarness(patch: Partial<AccountLoginsOptions> = {}) {
  const processes: FakeProcess[] = [];
  const ended: AccountLogin[] = [];
  let changes = 0;
  let ids = 0;
  const finish: LoginFinisher = () => Promise.resolve({ ok: true, email: 'new@x.dev' });
  const logins = new AccountLogins({
    spawn: (command, options) => {
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
    },
    finish,
    onChange: () => {
      changes++;
    },
    onEnded: (login) => ended.push(login),
    now: () => 42,
    newId: () => `login-${++ids}`,
    timers: QUIET,
    ...patch,
  });
  const current = () => logins.current() as AccountLogin;
  const process = (index = 0) => processes[index] as FakeProcess;
  return { logins, processes, process, ended, current, changes: () => changes };
}

describe('sign-in link', () => {
  test('is read from a terminal hyperlink ended by BEL or ST', () => {
    expect(parseLoginUrl(`Open \u001b]8;;${URL}\u0007this link\u001b]8;;\u0007`)).toBe(URL);
    expect(parseLoginUrl(`\u001b]8;id=1;${URL}\u001b\\here\u001b]8;;\u001b\\`)).toBe(URL);
  });

  test('is read from plain text with colours and cursor moves around it', () => {
    const output = `\u001b[2J\u001b[?25lBrowser didn't open? Use the url below:\r\n\u001b[1m\u001b[36m${URL}\u001b[0m\r\n`;
    expect(parseLoginUrl(output)).toBe(URL);
  });

  test('ignores links that are not the OAuth authorize page', () => {
    expect(
      parseLoginUrl('See https://docs.anthropic.com/claude-code and https://claude.ai/login')
    ).toBeNull();
    expect(parseLoginUrl('')).toBeNull();
  });
});

describe('account logins', () => {
  test('starting runs claude auth login for claude.ai in the account’s folder', () => {
    const { logins, process, changes } = createHarness();
    const login = logins.start(START);
    expect(login).toEqual({
      id: 'login-1',
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

  test('the link Claude prints moves the sign-in to waiting with the link', () => {
    const { logins, process, current } = createHarness();
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
    const { logins, process } = createHarness({ timers: { ...QUIET, menuFallbackMs: 5 } });
    logins.start(START);
    await until('the menu choice', () => process().writes.includes('\r'));
    expect(process().writes).toEqual(['\r']);
    logins.stop();
  });

  test('the menu fallback does nothing once the link is shown', async () => {
    const { logins, process } = createHarness({ timers: { ...QUIET, menuFallbackMs: 5, watchdogMs: 30 } });
    logins.start(START);
    process().print(URL);
    await until('the watchdog', () => logins.current()?.phase === 'failed');
    expect(process().writes).toEqual([]);
  });

  test('no link in time fails with the last thing Claude printed and the keychain hint', async () => {
    const { logins, process, current, ended } = createHarness({ timers: { ...QUIET, urlTimeoutMs: 5 } });
    logins.start(START);
    process().print('\u001b[31mError: keychain locked\u001b[0m\r\n\r\n');
    await until('the timeout', () => current().phase === 'failed');
    expect(current().message).toBe(
      `Claude did not show a sign-in link (Error: keychain locked). ${KEYCHAIN_HINT}`
    );
    expect(process().kills).toBe(1);
    expect(ended).toEqual([current()]);
  });

  test('no output at all says it printed nothing', async () => {
    const { logins, current } = createHarness({ timers: { ...QUIET, urlTimeoutMs: 5 } });
    logins.start(START);
    await until('the timeout', () => current().phase === 'failed');
    expect(current().message).toBe(
      `Claude did not show a sign-in link (it printed nothing). ${KEYCHAIN_HINT}`
    );
  });

  test('the link timeout does nothing once the link is shown', async () => {
    const { logins, process, current } = createHarness({
      timers: { ...QUIET, urlTimeoutMs: 5, watchdogMs: 30 },
    });
    logins.start(START);
    process().print(URL);
    await until('the watchdog', () => current().phase === 'failed');
    expect(current().message).toBe('The sign-in took too long, so Shinsa stopped it.');
  });

  test('the code is typed into Claude with Enter and the sign-in moves to finishing', () => {
    const { logins, process, current } = createHarness();
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
    const { logins, process, current, ended } = createHarness();
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
    const { logins, process, current } = createHarness({
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
    const { logins, process, current } = createHarness({
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
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const { logins, process, current } = createHarness({
        finish: () => Promise.reject(new Error('keychain timed out')),
      });
      logins.start(START);
      process().exit.resolve(0);
      await until('failed', () => current().phase === 'failed');
      expect(current().message).toBe('Shinsa could not check the sign-in: keychain timed out');
      expect(warn).toHaveBeenCalledWith('[Accounts] Could not check the account after signing in', {
        accountId: 'acc-1',
        error: 'keychain timed out',
      });
    } finally {
      warn.mockRestore();
    }
  });

  test('Claude ending on its own without a code fails with its last line', async () => {
    const { logins, process, current } = createHarness();
    logins.start(START);
    process().print('Login failed: network unreachable\n');
    process().exit.resolve(1);
    await until('failed', () => current().phase === 'failed');
    expect(current().message).toBe('Claude ended the sign-in (Login failed: network unreachable).');
  });

  test('a process that cannot report its exit fails with the reason', async () => {
    const { logins, process, current } = createHarness();
    logins.start(START);
    process().exit.reject(new Error('pty closed'));
    await until('failed', () => current().phase === 'failed');
    expect(current().message).toBe('pty closed');
  });

  test('cancelling stops Claude and says you cancelled; clearing then forgets the sign-in', () => {
    const { logins, process, current, ended, changes } = createHarness();
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
    const { logins, process, current } = createHarness();
    const { id } = logins.start(START);
    process().exit.resolve(0);
    await until('done', () => current().phase === 'done');
    logins.clear(id);
    expect(logins.current()).toBeNull();
  });

  test('starting a second sign-in ends the first, whose later exit changes nothing', async () => {
    const { logins, process, current, ended } = createHarness();
    logins.start(START);
    const second = logins.start({ ...START, accountId: 'acc-2', email: null });
    expect(ended).toEqual([
      expect.objectContaining({ id: 'login-1', phase: 'failed', message: 'Another sign-in started.' }),
    ]);
    expect(process(0).kills).toBe(1);
    expect(second).toMatchObject({ id: 'login-2', accountId: 'acc-2', phase: 'starting' });
    process(0).print(URL);
    process(0).exit.resolve(0);
    await process(0).exit.promise;
    expect(current()).toMatchObject({ id: 'login-2', phase: 'starting', url: null });
    logins.stop();
  });

  test('a later exit of an ended sign-in is ignored', async () => {
    const { logins, process, current, ended } = createHarness();
    const { id } = logins.start(START);
    logins.cancel(id);
    process().exit.resolve(0);
    await process().exit.promise;
    expect(current().phase).toBe('failed');
    expect(ended).toHaveLength(1);
  });

  test('a claude that cannot start fails at once with the reason', () => {
    const { logins, ended } = createHarness({
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
    const { logins, process, current } = createHarness({ timers: { ...QUIET, watchdogMs: 5 } });
    logins.start(START);
    process().print(URL);
    await until('the watchdog', () => current().phase === 'failed');
    expect(current().message).toBe('The sign-in took too long, so Shinsa stopped it.');
    expect(process().kills).toBe(1);
  });

  test('stopping Shinsa ends an open sign-in, and does nothing without one', () => {
    const { logins, current } = createHarness();
    logins.stop();
    expect(logins.current()).toBeNull();
    logins.start(START);
    logins.stop();
    expect(current()).toMatchObject({ phase: 'failed', message: 'Shinsa stopped.' });
  });

  test('ids, clock and timers have working defaults, and onEnded is optional', () => {
    const logins = new AccountLogins({
      spawn: () => ({
        write: () => undefined,
        kill: () => undefined,
        exited: new Promise<number>(() => undefined),
      }),
      finish: () => Promise.resolve({ ok: true, email: null }),
      onChange: () => undefined,
    });
    const login = logins.start(START);
    expect(login.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(login.startedAt).toBeGreaterThan(0);
    logins.stop();
    expect(logins.current()?.message).toBe('Shinsa stopped.');
  });
});

describe('login terminal', () => {
  test('runs the command in a terminal: output arrives, input reaches it and the exit code comes back', async () => {
    let output = '';
    const child = spawnLoginTerminal(
      ['/bin/sh', '-c', 'printf "ready:$SHINSA_PROBE:$TERM\\n"; read line; printf "got:%s\\n" "$line"'],
      {
        cwd: '/',
        env: { SHINSA_PROBE: 'probe' },
        onData: (text) => {
          output += text;
        },
      }
    );
    await until('the prompt', () => output.includes('ready:probe:xterm-256color'));
    child.write('hello\r');
    await until('the answer', () => output.includes('got:hello'));
    expect(await child.exited).toBe(0);
  });

  test('a variable the caller clears is not inherited from the server’s environment', async () => {
    let output = '';
    const restore = overrideEnv({ SHINSA_PROBE: 'inherited' });
    try {
      const child = spawnLoginTerminal(['/bin/sh', '-c', 'printf "probe:[%s]\\n" "$SHINSA_PROBE"'], {
        cwd: '/',
        env: { SHINSA_PROBE: undefined },
        onData: (text) => {
          output += text;
        },
      });
      expect(await child.exited).toBe(0);
    } finally {
      restore();
    }
    await until('the output', () => output.includes('probe:'));
    expect(output).toContain('probe:[]');
  });

  test('killing the terminal ends the command', async () => {
    const child = spawnLoginTerminal(['/bin/sh', '-c', 'sleep 30'], {
      cwd: '/',
      env: {},
      onData: () => undefined,
    });
    child.kill();
    expect(await child.exited).not.toBe(0);
  });
});
