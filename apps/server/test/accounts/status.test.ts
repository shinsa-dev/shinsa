import { describe, expect, test } from 'bun:test';
import {
  type ClaudeRunner,
  parseAuthStatus,
  readAuthStatus,
  STATUS_TIMEOUT_MS,
} from '../../src/accounts/status.ts';
import type { CommandOptions, CommandResult } from '../../src/shell/index.ts';

function createResult(result: Partial<CommandResult>): CommandResult {
  return { ok: true, code: 0, stdout: '', stderr: '', timedOut: false, ...result };
}

describe('claude auth status', () => {
  test('a signed-in login reports email, organization and plan', () => {
    const stdout = JSON.stringify({
      loggedIn: true,
      email: ' me@example.com ',
      orgName: 'Acme',
      subscriptionType: 'max',
    });
    expect(parseAuthStatus(createResult({ stdout }))).toEqual({
      signIn: 'signed_in',
      email: 'me@example.com',
      organization: 'Acme',
      plan: 'max',
      detail: null,
    });
  });

  test('the email may come as account or from the OAuth account, and noise around the JSON is ignored', () => {
    const fromAccount = `Checking…\n${JSON.stringify({ loggedIn: true, account: 'a@x.dev' })}\ndone`;
    expect(parseAuthStatus(createResult({ stdout: fromAccount })).email).toBe('a@x.dev');
    const fromOauth = JSON.stringify({ loggedIn: true, oauthAccount: { emailAddress: 'o@x.dev' } });
    expect(parseAuthStatus(createResult({ stdout: fromOauth })).email).toBe('o@x.dev');
    const none = parseAuthStatus(createResult({ stdout: JSON.stringify({ loggedIn: true, email: ' ' }) }));
    expect(none).toEqual({ signIn: 'signed_in', email: null, organization: null, plan: null, detail: null });
  });

  test('a login that is not signed in says so', () => {
    expect(parseAuthStatus(createResult({ stdout: '{"loggedIn":false}' }))).toEqual({
      signIn: 'signed_out',
      email: null,
      organization: null,
      plan: null,
      detail: 'Not signed in.',
    });
  });

  test('output that is not JSON is unknown, with the first line as the detail', () => {
    const failed = parseAuthStatus(
      createResult({ ok: false, code: 1, stderr: 'error: unknown option\nusage…' })
    );
    expect(failed).toEqual({
      signIn: 'unknown',
      email: null,
      organization: null,
      plan: null,
      detail: 'error: unknown option',
    });
    expect(parseAuthStatus(createResult({ stdout: '} nothing {' })).detail).toBe('} nothing {');
    expect(parseAuthStatus(createResult({ stdout: '{broken}' })).detail).toBe('{broken}');
    expect(parseAuthStatus(createResult({})).detail).toBeNull();
  });

  test('runs claude auth status --json with the account env and a timeout', async () => {
    const calls: [string[], string, CommandOptions][] = [];
    const run: ClaudeRunner = (command, cwd, options) => {
      calls.push([command, cwd, options]);
      return Promise.resolve(createResult({ stdout: '{"loggedIn":true,"email":"me@x.dev"}' }));
    };
    const status = await readAuthStatus(run, '/bin/claude', { CLAUDE_CONFIG_DIR: '/acc' }, '/work');
    expect(status.email).toBe('me@x.dev');
    expect(calls).toEqual([
      [
        ['/bin/claude', 'auth', 'status', '--json'],
        '/work',
        { env: { CLAUDE_CONFIG_DIR: '/acc' }, timeoutMs: STATUS_TIMEOUT_MS },
      ],
    ]);
  });

  test('a claude that takes too long is unknown, not signed out', async () => {
    const run: ClaudeRunner = () => Promise.resolve(createResult({ ok: false, timedOut: true }));
    expect(await readAuthStatus(run, 'claude', {}, '/')).toEqual({
      signIn: 'unknown',
      email: null,
      organization: null,
      plan: null,
      detail: 'Claude took too long to answer.',
    });
  });
});
