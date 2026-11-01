import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CommandRunner,
  isBunUsed,
  listMissingInstalls,
  type Prerequisite,
  resolveInstallCommand,
  resolveInstallScript,
  resolvePrerequisiteLabel,
  resolvePrerequisites,
} from '../../src/onboarding/prerequisites.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import { createTempDir } from '../helpers/index.ts';

const HOME = '/Users/me';

function result(ok: boolean, stdout = '', stderr = '', timedOut = false, code = ok ? 0 : 1): CommandResult {
  return { ok, code, stdout, stderr, timedOut };
}

const MISSING = result(false, '', 'Executable not found in $PATH', false, 127);

function createRunner(answers: Record<string, CommandResult>): CommandRunner {
  return (command, cwd) => {
    expect(cwd).toBe(HOME);
    return Promise.resolve(answers[command.join(' ')] ?? MISSING);
  };
}

const READY: Record<string, CommandResult> = {
  'git --version': result(true, 'git version 2.50.0'),
  'brew --version': result(true, 'Homebrew 5.0.0'),
  'gh --version': result(true, 'gh version 2.80.0 (2026-01-01)\nhttps://github.com/cli/cli'),
  'gh auth status': result(true, 'github.com\n  ✓ Logged in to github.com account octo (keyring)'),
  'claude --version': result(true, '2.1.287 (Claude Code)'),
  'codex --version': result(true, 'codex-cli 0.153.4'),
  'codex login status': result(true, 'Logged in using ChatGPT'),
  'bun --version': result(true, '1.4.2'),
};

function withoutKeys(keys: string[]) {
  return Object.fromEntries(Object.entries(READY).filter(([key]) => !keys.includes(key)));
}

describe('resolvePrerequisites', () => {
  test('reports each tool with its version, and leaves out Homebrew when nothing needs it', async () => {
    const report = await resolvePrerequisites(HOME, createRunner(READY));
    expect(report.ready).toBe(true);
    expect(report.checks.map((check) => [check.id, check.detail])).toEqual([
      ['git', 'git version 2.50.0'],
      ['gh', 'Signed in as octo.'],
      ['claude', '2.1.287 (Claude Code)'],
      ['bun', '1.4.2'],
      ['codex', 'codex-cli 0.153.4'],
    ]);
    expect(report.checks.every((check) => check.fix === null && check.command === null)).toBe(true);
  });

  test('no longer asks whether Claude Code itself is signed in: Shinsa signs in its own accounts', async () => {
    const report = await resolvePrerequisites(HOME, createRunner(READY));
    expect(report.checks.map((check) => check.id)).not.toContain('claude_auth');
  });

  test('says what is missing and the command that installs it, Claude Code included', async () => {
    const report = await resolvePrerequisites(
      HOME,
      createRunner({
        'git --version': result(false, '', '', true),
        'brew --version': result(true, 'Homebrew'),
      })
    );
    expect(report.ready).toBe(false);
    expect(report.checks.map((check) => [check.id, check.ok, check.detail, check.command])).toEqual([
      ['git', false, 'It did not answer in time.', 'xcode-select --install'],
      ['brew', true, 'Homebrew', null],
      ['gh', false, 'Not installed.', 'brew install gh'],
      ['claude', false, 'Not installed.', 'curl -fsSL https://claude.ai/install.sh | bash'],
      ['bun', false, 'Not installed.', 'curl -fsSL https://bun.sh/install | bash'],
      ['codex', false, 'Not installed.', 'npm install -g @openai/codex'],
    ]);
    expect(report.checks.find((check) => check.id === 'claude')?.fix).toBe(
      'Install Claude Code, which agents run on.'
    );
  });

  test('asks for Homebrew first when the GitHub CLI needs it and it is missing', async () => {
    const report = await resolvePrerequisites(
      HOME,
      createRunner(withoutKeys(['brew --version', 'gh --version']))
    );
    expect(report.ready).toBe(false);
    expect(report.checks.slice(0, 3).map((check) => [check.id, check.ok, check.optional ?? false])).toEqual([
      ['git', true, false],
      ['brew', false, false],
      ['gh', false, false],
    ]);
    expect(report.checks[1]).toMatchObject({
      fix: 'Install Homebrew, which installs the GitHub CLI.',
      command: expect.stringContaining('Homebrew/install/HEAD/install.sh'),
    });
  });

  test('Bun is needed only when a repository uses it', async () => {
    const runner = createRunner(withoutKeys(['bun --version']));
    const needed = await resolvePrerequisites(HOME, runner, { bun: true });
    expect(needed.ready).toBe(false);
    expect(needed.checks.find((check) => check.id === 'bun')).toMatchObject({
      ok: false,
      fix: 'Your repositories use Bun. Install it so agents can run their checks.',
    });
    expect(needed.checks.find((check) => check.id === 'bun')?.optional).toBeUndefined();
    const unneeded = await resolvePrerequisites(HOME, runner, { bun: false });
    expect(unneeded.ready).toBe(true);
    expect(unneeded.checks.find((check) => check.id === 'bun')).toMatchObject({
      ok: false,
      optional: true,
      fix: 'Only for repositories that use Bun.',
    });
  });

  test('Codex is optional, and so is Homebrew when only Codex would need it', async () => {
    const missing = await resolvePrerequisites(HOME, createRunner(withoutKeys(['codex --version'])));
    expect(missing.ready).toBe(true);
    expect(missing.checks.filter((check) => check.optional).map((check) => check.id)).toEqual(['codex']);
  });

  test('leaves the Codex sign-in to the Claude step, which shows it', async () => {
    const report = await resolvePrerequisites(HOME, createRunner(READY));
    expect(report.checks.map((check) => check.id)).not.toContain('codex_auth');
  });

  test('reads an older gh that prints plain text, and a failure with no output', async () => {
    const report = await resolvePrerequisites(
      HOME,
      createRunner({
        ...READY,
        'gh auth status': result(true, '', 'Logged in'),
        'bun --version': result(false, '', '', false, 3),
      })
    );
    expect(report.checks.find((check) => check.id === 'gh')?.detail).toBe('Signed in.');
    expect(report.checks.find((check) => check.id === 'bun')?.detail).toBe('It exited with code 3.');
    const signedOut = await resolvePrerequisites(
      HOME,
      createRunner({ ...READY, 'gh auth status': result(false, '', 'You are not logged in') })
    );
    expect(signedOut.checks.find((check) => check.id === 'gh')).toMatchObject({
      label: 'GitHub CLI',
      ok: false,
      detail: 'Not signed in.',
      fix: 'Sign in to GitHub, so Shinsa can open and merge pull requests.',
      command: 'gh auth login',
      signIn: true,
    });
    expect(signedOut.checks.map((check) => check.id)).not.toContain('brew');
    expect(signedOut.checks.map((check) => check.id)).not.toContain('gh_auth');
  });
});

describe('the install commands', () => {
  test('come only from the fixed list, by check id', () => {
    expect(resolveInstallCommand('gh')).toBe('brew install gh');
    expect(resolvePrerequisiteLabel('gh')).toBe('GitHub CLI');
    expect(resolveInstallCommand('rm -rf ~')).toBeNull();
    expect(resolveInstallCommand('toString')).toBeNull();
    expect(resolvePrerequisiteLabel('constructor')).toBeNull();
  });
});

describe('the install scripts', () => {
  test('wait for Apple’s installer window, and put Homebrew on PATH for the commands after it', () => {
    expect(resolveInstallScript('git')).toContain('until xcode-select -p');
    expect(resolveInstallScript('brew')).toEndWith(
      '&& eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"'
    );
    expect(resolveInstallScript('gh')).toBe(
      '{ command -v gh >/dev/null 2>&1 || brew install gh; } && { gh auth status >/dev/null 2>&1 || gh auth login; }'
    );
    expect(resolveInstallScript('toString')).toBeNull();
  });

  test('list the required missing tools in the order they need each other, leaving Git to Homebrew', () => {
    const check = (id: string, ok: boolean, optional = false) =>
      ({ id, ok, ...(optional ? { optional } : {}) }) as Prerequisite;
    expect(
      listMissingInstalls([
        check('bun', false),
        check('gh', false),
        check('codex', false, true),
        check('brew', false),
        check('git', false),
        check('claude', true),
      ])
    ).toEqual(['brew', 'gh', 'bun']);
    expect(listMissingInstalls([check('git', false), check('gh', true)])).toEqual(['git']);
  });

  test('read Apple’s Git placeholder, which runs without the command line tools, as not installed', async () => {
    const shim = result(
      false,
      '',
      'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)'
    );
    const report = await resolvePrerequisites(HOME, createRunner({ ...READY, 'git --version': shim }));
    expect(report.checks.find((check) => check.id === 'git')).toMatchObject({
      ok: false,
      detail: 'Not installed.',
    });
  });
});

describe('isBunUsed', () => {
  test('finds a Bun lockfile or bunfig in a folder or a repository one level inside it', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'plain'), { recursive: true });
    mkdirSync(join(root, '.hidden'), { recursive: true });
    writeFileSync(join(root, '.hidden', 'bun.lock'), '');
    writeFileSync(join(root, 'notes.txt'), '');
    expect(isBunUsed([root, join(root, 'missing')])).toBe(false);
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'app', 'bun.lockb'), '');
    expect(isBunUsed([root])).toBe(true);
    const own = createTempDir();
    writeFileSync(join(own, 'bunfig.toml'), '');
    expect(isBunUsed([own])).toBe(true);
    expect(isBunUsed([])).toBe(false);
  });
});
