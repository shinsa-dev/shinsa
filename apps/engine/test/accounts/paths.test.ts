import { describe, expect, spyOn, test } from 'bun:test';
import * as os from 'node:os';
import {
  ACCOUNT_OWNED_ENTRIES,
  DEFAULT_KEYCHAIN_SERVICE,
  resolveAccountDir,
  resolveAccountsDir,
  resolveKeychainAccount,
  resolveKeychainService,
  resolveRegistryPath,
  resolveSharedConfigDir,
  resolveSharedGlobalConfig,
} from '../../src/accounts/paths.ts';

describe('account paths', () => {
  test('accounts live under the Shinsa home, one folder each, next to accounts.json', () => {
    expect(resolveAccountsDir('/home/shinsa')).toBe('/home/shinsa/accounts');
    expect(resolveAccountDir('/home/shinsa', 'a1b2c3d4')).toBe('/home/shinsa/accounts/a1b2c3d4');
    expect(resolveRegistryPath('/home/shinsa')).toBe('/home/shinsa/accounts.json');
  });

  test('the shared Claude config is CLAUDE_CONFIG_DIR when set, otherwise ~/.claude and ~/.claude.json', () => {
    expect(resolveSharedConfigDir({}, '/Users/me')).toBe('/Users/me/.claude');
    expect(resolveSharedConfigDir({ CLAUDE_CONFIG_DIR: '  ' }, '/Users/me')).toBe('/Users/me/.claude');
    expect(resolveSharedConfigDir({ CLAUDE_CONFIG_DIR: ' /cfg ' }, '/Users/me')).toBe('/cfg');
    expect(resolveSharedGlobalConfig({}, '/Users/me')).toBe('/Users/me/.claude.json');
    expect(resolveSharedGlobalConfig({ CLAUDE_CONFIG_DIR: '/cfg' }, '/Users/me')).toBe('/cfg/.claude.json');
  });

  test('the login and the signed-in account are never shared between accounts', () => {
    for (const entry of ['.claude.json', '.credentials.json', 'backups', '.oauth_refresh.lock']) {
      expect(ACCOUNT_OWNED_ENTRIES.has(entry)).toBe(true);
    }
    expect(ACCOUNT_OWNED_ENTRIES.has('projects')).toBe(false);
  });

  test('the keychain service is the default one without a config dir, else hashed like Claude Code does', () => {
    expect(resolveKeychainService(null)).toBe(DEFAULT_KEYCHAIN_SERVICE);
    expect(resolveKeychainService(null)).toBe('Claude Code-credentials');
    expect(resolveKeychainService('/Users/christo/.claude')).toBe('Claude Code-credentials-09ac30cc');
  });

  test('the keychain service hashes the NFC form, so composed and decomposed paths agree', () => {
    const composed = '/Users/josé/.claude';
    const decomposed = '/Users/josé/.claude';
    expect(resolveKeychainService(decomposed)).toBe(resolveKeychainService(composed));
    expect(resolveKeychainService(composed)).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/);
  });

  test('the keychain account is $USER, then the login name, then a fixed fallback', () => {
    expect(resolveKeychainAccount({ USER: 'christo' })).toBe('christo');
    const info = spyOn(os, 'userInfo');
    try {
      info.mockReturnValue({ username: 'from-os' } as os.UserInfo<string>);
      expect(resolveKeychainAccount({})).toBe('from-os');
      info.mockReturnValue({ username: '' } as os.UserInfo<string>);
      expect(resolveKeychainAccount({})).toBe('claude-code-user');
      info.mockImplementation(() => {
        throw new Error('no passwd entry');
      });
      expect(resolveKeychainAccount({})).toBe('claude-code-user');
    } finally {
      info.mockRestore();
    }
  });
});
