import { describe, expect, test } from 'bun:test';
import { DomainError } from '@shinsa/core';
import { Cswap } from '../../src/accounts/cswap.ts';
import { AccountImports } from '../../src/accounts/imports.ts';
import { AccountStore } from '../../src/accounts/store.ts';
import { createTempDir } from '../helpers/index.ts';

const LIST = JSON.stringify({ accounts: [{ email: 'Known@x.dev' }, { email: 'new@x.dev' }] });

function createImports(signIn: (email: string) => Promise<void>) {
  const home = createTempDir();
  const store = new AccountStore({
    home,
    sharedDir: `${home}/shared`,
    sharedGlobalConfig: `${home}/shared.json`,
  });
  store.create({ email: 'known@x.dev' });
  const cswap = new Cswap({
    run: () => Promise.resolve({ ok: true, code: 0, stdout: LIST, stderr: '', timedOut: false }),
    which: () => '/bin/cswap',
  });
  let changes = 0;
  const imports = new AccountImports({
    store,
    cswap,
    signIn,
    onChange: () => {
      changes++;
    },
  });
  return { imports, changes: () => changes };
}

describe('account imports', () => {
  test('lists the claude-swap accounts Shinsa does not have yet and announces them', async () => {
    const { imports, changes } = createImports(() => Promise.resolve());
    expect(imports.list()).toEqual([]);
    await imports.sync();
    expect(imports.list()).toEqual([{ origin: 'cswap', email: 'new@x.dev', plan: null }]);
    expect(changes()).toBe(1);
  });

  test('importing signs in to the named account, and refuses one already added or unnamed', async () => {
    const signedIn: string[] = [];
    const { imports } = createImports((email) => {
      signedIn.push(email);
      return Promise.resolve();
    });
    await imports.importAccount('cswap', '  new@x.dev ');
    expect(signedIn).toEqual(['new@x.dev']);
    await expect(imports.importAccount('cswap', 'known@x.dev')).rejects.toMatchObject({
      code: 'account_exists',
    });
    await expect(imports.importAccount('cswap', ' ')).rejects.toMatchObject({ code: 'import_invalid' });
    await expect(imports.importAccount('other', 'new@x.dev')).rejects.toMatchObject({
      code: 'import_invalid',
    });
  });

  test('a sign-in refused by Shinsa keeps its reason, and one that breaks is named', async () => {
    const refused = createImports(() =>
      Promise.reject(new DomainError({ code: 'claude_missing', message: 'Install Claude.' }))
    );
    await expect(refused.imports.importAccount('cswap', 'new@x.dev')).rejects.toBeInstanceOf(DomainError);
    const broken = createImports(() => Promise.reject(new Error('pty closed')));
    await expect(broken.imports.importAccount('cswap', 'new@x.dev')).rejects.toMatchObject({
      _tag: 'ImportSignInFailed',
      message: 'pty closed',
    });
  });
});
