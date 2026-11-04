import { afterEach, describe, expect, test } from 'bun:test';
import { AccountImports } from '../../src/accounts/imports/service.ts';
import { AccountStore } from '../../src/accounts/store/service.ts';
import { type AccountsHarness, buildUnitAccounts } from './harness.ts';

const LIST = JSON.stringify({ accounts: [{ email: 'Known@x.dev' }, { email: 'new@x.dev' }] });

const open: AccountsHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function createImports() {
  const harness = await buildUnitAccounts({
    run: (command) =>
      Promise.resolve({
        ok: command[0] === 'cswap',
        code: command[0] === 'cswap' ? 0 : 127,
        stdout: LIST,
        stderr: '',
        timedOut: false,
      }),
  });
  open.push(harness);
  await harness.run(harness.service(AccountStore).create({ email: 'known@x.dev' }));
  return { harness, imports: harness.service(AccountImports) };
}

describe('account imports', () => {
  test('lists the claude-swap accounts Shinsa does not have yet', async () => {
    const { harness, imports } = await createImports();
    expect(await harness.run(imports.list)).toEqual([]);
    await harness.run(imports.sync);
    expect(await harness.run(imports.list)).toEqual([{ origin: 'cswap', email: 'new@x.dev', plan: null }]);
  });

  test('an import names a claude-swap account Shinsa does not have yet', async () => {
    const { harness, imports } = await createImports();
    expect(await harness.run(imports.resolveImportEmail('cswap', '  new@x.dev '))).toBe('new@x.dev');
    await expect(harness.run(imports.resolveImportEmail('cswap', 'known@x.dev'))).rejects.toMatchObject({
      code: 'account_exists',
    });
    await expect(harness.run(imports.resolveImportEmail('cswap', ' '))).rejects.toMatchObject({
      code: 'import_invalid',
    });
    await expect(harness.run(imports.resolveImportEmail('other', 'new@x.dev'))).rejects.toMatchObject({
      code: 'import_invalid',
    });
  });
});
