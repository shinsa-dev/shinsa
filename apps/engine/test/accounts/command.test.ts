import { afterEach, describe, expect, test } from 'bun:test';
import { Duration } from 'effect';
import { AccountCommands } from '../../src/accounts/command/service.ts';
import { createTempDir } from '../helpers/index.ts';
import { type AccountsHarness, buildUnitAccounts } from './harness.ts';

const open: AccountsHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

describe('account commands', () => {
  test('a program that is not installed answers like a shell does, with exit code 127', async () => {
    const harness = await buildUnitAccounts({ realShell: true });
    open.push(harness);
    const commands = harness.service(AccountCommands);
    const result = await harness.run(
      commands.run(['shinsa-no-such-program'], createTempDir(), { timeout: Duration.seconds(5) })
    );
    expect(result).toMatchObject({ ok: false, code: 127, stdout: '', timedOut: false });
    expect(result.stderr).toContain('shinsa-no-such-program');
  });
});
