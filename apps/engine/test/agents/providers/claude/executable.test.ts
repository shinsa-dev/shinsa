import { describe, expect, test } from 'bun:test';
import { chmodSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  parseClaudeVersion,
  readClaudeVersion,
  resolveClaudeExecutable,
  resolveSdkClaudeVersion,
  resolveSdkPackage,
} from '../../../../src/agents/providers/claude/executable.ts';
import { compareVersions } from '../../../../src/agents/providers/versions.ts';
import { createTempDir } from '../../../helpers/index.ts';

function fakeClaude(output: string) {
  const dir = createTempDir();
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh\necho "${output}"\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('versions', () => {
  test('reads the version from `claude --version` and compares them numerically', () => {
    expect(parseClaudeVersion('2.1.280 (Claude Code)')).toBe('2.1.280');
    expect(parseClaudeVersion('no version here')).toBeNull();
    expect(compareVersions('2.1.10', '2.1.9')).toBe(1);
    expect(compareVersions('2.1.9', '2.1.10')).toBe(-1);
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
    expect(compareVersions('2.x.1', '2.0.1')).toBe(0);
  });

  test('the minimum is the Claude Code version the SDK was built against', () => {
    expect(resolveSdkClaudeVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    const dir = createTempDir();
    const bare = join(dir, 'package.json');
    writeFileSync(bare, '{}');
    expect(resolveSdkClaudeVersion(bare)).toBe('0.0.0');
    expect(resolveSdkPackage(bare)).toEqual({ version: '0.0.0', claudeCodeVersion: '0.0.0' });
    expect(resolveSdkPackage().version).toMatch(/^0\.\d+\.\d+$/);
  });

  test('asks the binary once and again only after it changes on disk', async () => {
    const path = fakeClaude('2.1.300 (Claude Code)');
    expect(await readClaudeVersion(path)).toBe('2.1.300');
    writeFileSync(path, '#!/bin/sh\necho "2.1.301 (Claude Code)"\n');
    utimesSync(path, new Date(1_000), new Date(1_000));
    const restamped = await readClaudeVersion(path);
    expect(restamped).toBe('2.1.301');
    expect(await readClaudeVersion(path)).toBe('2.1.301');
    expect(await readClaudeVersion(join(createTempDir(), 'missing'))).toBeNull();
  });
});

describe('resolveClaudeExecutable', () => {
  test('CLAUDE_EXECUTABLE wins and is trusted as is, with ~ expanded', async () => {
    expect(await resolveClaudeExecutable({ env: { CLAUDE_EXECUTABLE: '~/bin/claude-bedrock' } })).toEqual({
      ok: true,
      path: join(homedir(), 'bin/claude-bedrock'),
      version: null,
    });
  });

  test('without claude on the PATH it says how to install it', async () => {
    const resolved = await resolveClaudeExecutable({ env: {}, which: () => null });
    expect(resolved).toMatchObject({ ok: false, reason: 'not_installed' });
    expect(resolved.ok ? '' : resolved.message).toContain('Claude Code is not installed');
  });

  test('a claude older than the SDK needs is refused with the update command', async () => {
    const resolved = await resolveClaudeExecutable({
      env: {},
      which: () => '/bin/claude',
      readVersion: () => Promise.resolve('2.1.100'),
      minimumVersion: '2.1.280',
    });
    expect(resolved).toEqual({
      ok: false,
      reason: 'outdated',
      message:
        'Claude Code 2.1.100 is older than Shinsa needs (2.1.280 or newer). Update it from Settings → Agents, or run `claude update`.',
    });
  });

  test('a current claude, or one whose version cannot be read, is used', async () => {
    const current = await resolveClaudeExecutable({
      env: {},
      which: () => '/bin/claude',
      readVersion: () => Promise.resolve('2.1.280'),
      minimumVersion: '2.1.280',
    });
    expect(current).toEqual({ ok: true, path: '/bin/claude', version: '2.1.280' });
    const unreadable = await resolveClaudeExecutable({
      env: {},
      which: () => '/bin/claude',
      readVersion: () => Promise.resolve(null),
    });
    expect(unreadable).toEqual({ ok: true, path: '/bin/claude', version: null });
  });
});
