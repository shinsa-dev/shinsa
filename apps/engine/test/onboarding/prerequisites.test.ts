import { describe, expect, test } from 'bun:test';
import { type CommandRunner, resolvePrerequisites } from '../../src/onboarding/prerequisites.ts';
import type { CommandResult } from '../../src/shell/index.ts';

const HOME = '/Users/me';

function result(ok: boolean, stdout = '', stderr = '', timedOut = false): CommandResult {
  return { ok, code: ok ? 0 : 1, stdout, stderr, timedOut };
}

function createRunner(answers: Record<string, CommandResult>): CommandRunner {
  return (command, cwd) => {
    expect(cwd).toBe(HOME);
    return Promise.resolve(answers[command.join(' ')] ?? result(false, '', '', false));
  };
}

const READY: Record<string, CommandResult> = {
  'git --version': result(true, 'git version 2.50.0'),
  'gh --version': result(true, 'gh version 2.80.0 (2026-01-01)\nhttps://github.com/cli/cli'),
  'gh auth status': result(true, 'github.com\n  ✓ Logged in to github.com account octo (keyring)'),
  'claude --version': result(true, '2.1.287 (Claude Code)'),
  'claude auth status --json': result(true, JSON.stringify({ loggedIn: true, email: 'me@example.com' })),
  'codex --version': result(true, 'codex-cli 0.153.4'),
  'codex login status': result(true, 'Logged in using ChatGPT'),
  'bun --version': result(true, '1.4.2'),
};

describe('resolvePrerequisites', () => {
  test('reports each tool with its version and who is signed in', async () => {
    const report = await resolvePrerequisites(HOME, createRunner(READY));
    expect(report.ready).toBe(true);
    expect(report.checks.map((check) => [check.id, check.detail])).toEqual([
      ['git', 'git version 2.50.0'],
      ['gh', 'gh version 2.80.0 (2026-01-01)'],
      ['gh_auth', 'Signed in as octo.'],
      ['claude', '2.1.287 (Claude Code)'],
      ['claude_auth', 'Signed in as me@example.com.'],
      ['codex', 'codex-cli 0.153.4'],
      ['codex_auth', 'Logged in using ChatGPT'],
      ['bun', '1.4.2'],
    ]);
    expect(report.checks.every((check) => check.fix === null)).toBe(true);
  });

  test('Codex is optional: without it setup is still ready, and it says how to add it', async () => {
    const missing = await resolvePrerequisites(
      HOME,
      createRunner({ ...READY, 'codex --version': result(false, '') })
    );
    expect(missing.ready).toBe(true);
    expect(missing.checks.filter((check) => check.optional)).toEqual([
      expect.objectContaining({ id: 'codex', ok: false, detail: 'It exited with code 1.' }),
      expect.objectContaining({ id: 'codex_auth', ok: false, detail: 'Codex is missing.' }),
    ]);
    expect(missing.checks.find((check) => check.id === 'codex')?.fix).toContain(
      'npm install -g @openai/codex'
    );
    const signedOut = await resolvePrerequisites(
      HOME,
      createRunner({ ...READY, 'codex login status': result(false, '', 'Not logged in') })
    );
    expect(signedOut.checks.find((check) => check.id === 'codex_auth')).toMatchObject({
      ok: false,
      detail: 'Not logged in',
      fix: 'Only for agents you run on Codex: sign in with `codex login`.',
    });
  });

  test('says what is missing and how to fix it', async () => {
    const report = await resolvePrerequisites(
      HOME,
      createRunner({
        'git --version': result(false, '', '', true),
        'bun --version': result(false, '', 'command not found: bun'),
        'claude --version': result(true, '2.1.287'),
        'claude auth status --json': result(true, JSON.stringify({ loggedIn: false })),
      })
    );
    expect(report.ready).toBe(false);
    expect(report.checks.map((check) => [check.id, check.ok, check.detail])).toEqual([
      ['git', false, 'It did not answer in time.'],
      ['gh', false, 'It exited with code 1.'],
      ['gh_auth', false, 'The GitHub CLI is missing.'],
      ['claude', true, '2.1.287'],
      ['claude_auth', false, 'Not signed in.'],
      ['codex', false, 'It exited with code 1.'],
      ['codex_auth', false, 'Codex is missing.'],
      ['bun', false, 'command not found: bun'],
    ]);
    expect(report.checks[2]?.fix).toBe('Sign in to GitHub with `gh auth login`.');
  });

  test('reads older CLIs that print plain text, and a failed sign-in check', async () => {
    const report = await resolvePrerequisites(
      HOME,
      createRunner({
        ...READY,
        'gh auth status': result(true, '', 'Logged in'),
        'claude auth status --json': result(true, 'Logged in with a subscription'),
      })
    );
    expect(report.checks[2]?.detail).toBe('Signed in.');
    expect(report.checks[4]?.detail).toBe('Logged in with a subscription');
    const failed = await resolvePrerequisites(
      HOME,
      createRunner({ ...READY, 'claude auth status --json': result(false, '', 'unknown command') })
    );
    expect(failed.checks[4]).toMatchObject({ ok: false, detail: 'unknown command' });
  });

  test('a signed-out Claude Code exits with an error but still prints its status as JSON', async () => {
    const report = await resolvePrerequisites(
      HOME,
      createRunner({
        ...READY,
        'claude auth status --json': result(false, '{\n  "loggedIn": false,\n  "authMethod": "none"\n}'),
      })
    );
    expect(report.checks[4]).toMatchObject({ ok: false, detail: 'Not signed in.' });
  });
});
