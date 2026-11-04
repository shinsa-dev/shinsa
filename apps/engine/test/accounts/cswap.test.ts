import { afterEach, describe, expect, test } from 'bun:test';
import { parseCswapList } from '../../src/accounts/answers.ts';
import { Cswap } from '../../src/accounts/cswap/service.ts';
import type { CommandResult } from '../../src/shell/schema.ts';
import { captureLogs, createTempDir, createTestConfig } from '../helpers/index.ts';
import { type AccountsHarness, buildUnitAccounts, type FakeRunner } from './harness.ts';

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

const open: AccountsHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

function createRunner(installed: string[], results: Partial<CommandResult>[]) {
  const calls: string[][] = [];
  const run: FakeRunner = (command) => {
    if (!installed.includes(command[0] ?? ''))
      return Promise.resolve({ ok: false, code: 127, stdout: '', stderr: 'not found', timedOut: false });
    calls.push(command);
    const result = results[Math.min(calls.length - 1, results.length - 1)];
    return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, ...result });
  };
  return { run, calls };
}

async function createCswap(run: FakeRunner, userHome = createTempDir()) {
  const harness = await buildUnitAccounts({
    run,
    config: { ...createTestConfig(createTempDir()), userHome },
  });
  open.push(harness);
  const cswap = harness.service(Cswap);
  return { harness, list: () => harness.run(cswap.list) };
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
    const { run, calls } = createRunner(['cswap'], [{ stdout: LIST }]);
    const userHome = createTempDir();
    const { harness, list } = await createCswap(run, userHome);
    await harness.setTime(1_000);
    expect(await list()).toHaveLength(2);
    await harness.adjust(10 * 60_000 - 1);
    expect(await list()).toHaveLength(2);
    expect(calls).toEqual([['cswap', 'list', '--json']]);
    expect(harness.calls.at(-1)).toEqual({
      command: ['cswap', 'list', '--json'],
      cwd: userHome,
      timeoutMs: 30_000,
    });
    await harness.adjust(1);
    await list();
    expect(calls).toHaveLength(2);
  });

  test('without claude-swap installed there are no accounts', async () => {
    const { run, calls } = createRunner([], []);
    const { harness, list } = await createCswap(run);
    expect(await list()).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(harness.calls.map((call) => call.command[0])).toEqual(['cswap', 'claude-swap']);
  });

  test('a failed list is logged and gives nothing', async () => {
    const logs = captureLogs();
    try {
      const { run } = createRunner(['cswap'], [{ ok: false, code: 2, stdout: LIST }]);
      const { list } = await createCswap(run);
      expect(await list()).toEqual([]);
      expect(logs.fieldsOf('[Accounts] claude-swap did not list its accounts')).toEqual([{ code: 2 }]);
    } finally {
      logs.restore();
    }
  });

  test('looks for cswap, then claude-swap', async () => {
    const { run, calls } = createRunner(['claude-swap'], [{ stdout: LIST }]);
    const { list } = await createCswap(run);
    expect(await list()).toHaveLength(2);
    expect(calls).toEqual([['claude-swap', 'list', '--json']]);
  });
});
