import { describe, expect, spyOn, test } from 'bun:test';
import { homedir } from 'node:os';
import { Cswap, type CswapRunner, parseCswapList } from '../../src/accounts/cswap.ts';
import { log } from '../../src/log/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';

const LIST = JSON.stringify({
  accounts: [
    { email: 'a@x.dev', organizationName: 'Acme', kind: 'oauth' },
    { email: 'key@x.dev', kind: 'api_key' },
    { email: 'b@x.dev', organizationName: 7 },
    { organizationName: 'No email' },
    'junk',
    null,
  ],
});

function createRunner(results: Partial<CommandResult>[]) {
  const calls: { command: string[]; cwd: string; timeoutMs: number | null | undefined }[] = [];
  const run: CswapRunner = (command, cwd, options) => {
    calls.push({ command, cwd, timeoutMs: options.timeoutMs });
    const result = results[Math.min(calls.length - 1, results.length - 1)];
    return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, ...result });
  };
  return { run, calls };
}

describe('claude-swap output', () => {
  test('lists the OAuth accounts and skips API keys and junk', () => {
    expect(parseCswapList(LIST)).toEqual([{ email: 'a@x.dev' }, { email: 'b@x.dev' }]);
    expect(parseCswapList('{"accounts":"none"}')).toEqual([]);
    expect(parseCswapList('not json')).toEqual([]);
  });
});

describe('Cswap', () => {
  test('lists through cswap, then answers from memory for ten minutes', async () => {
    let now = 1_000;
    const { run, calls } = createRunner([{ stdout: LIST }]);
    const cswap = new Cswap({
      run,
      which: (name) => (name === 'cswap' ? '/bin/cswap' : null),
      now: () => now,
    });
    expect(await cswap.list()).toHaveLength(2);
    now += 10 * 60_000 - 1;
    expect(await cswap.list()).toHaveLength(2);
    expect(calls).toEqual([{ command: ['/bin/cswap', 'list', '--json'], cwd: homedir(), timeoutMs: 30_000 }]);
    now += 1;
    await cswap.list();
    expect(calls).toHaveLength(2);
  });

  test('without claude-swap installed there are no accounts', async () => {
    const { run, calls } = createRunner([]);
    const cswap = new Cswap({ run, which: () => null });
    expect(await cswap.list()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('a failed list is logged and gives nothing', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const { run } = createRunner([{ ok: false, code: 2, stdout: LIST }]);
      const cswap = new Cswap({ run, which: () => '/bin/cswap' });
      expect(await cswap.list()).toEqual([]);
      expect(warn.mock.calls).toEqual([['[Accounts] claude-swap did not list its accounts', { code: 2 }]]);
    } finally {
      warn.mockRestore();
    }
  });

  test('looks for cswap, then claude-swap, on PATH', async () => {
    const which = spyOn(Bun, 'which').mockImplementation((name) =>
      name === 'claude-swap' ? '/opt/claude-swap' : null
    );
    try {
      const { run, calls } = createRunner([{ stdout: LIST }]);
      await new Cswap({ run }).list();
      expect(which.mock.calls.map(([name]) => name)).toEqual(['cswap', 'claude-swap']);
      expect(calls[0]?.command[0]).toBe('/opt/claude-swap');
    } finally {
      which.mockRestore();
    }
  });
});
