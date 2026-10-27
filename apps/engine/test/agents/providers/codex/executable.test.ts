import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CODEX_MINIMUM_VERSION,
  parseCodexVersion,
  readCodexVersion,
  resolveCodexExecutable,
} from '../../../../src/agents/providers/codex/executable.ts';

const FAKE = join(import.meta.dirname, '../../../helpers/bin/codex');

describe('the codex Shinsa runs', () => {
  test('reads the version `codex --version` prints', async () => {
    expect(parseCodexVersion('codex-cli 0.153.4')).toBe('0.153.4');
    expect(parseCodexVersion('codex 1.2.3 (beta)')).toBe('1.2.3');
    expect(parseCodexVersion('no version')).toBeNull();
    expect(await readCodexVersion(FAKE)).toBe('0.200.0');
  });

  test('CODEX_EXECUTABLE wins, with ~ expanded, and is still version-checked', async () => {
    const resolved = await resolveCodexExecutable({
      env: { CODEX_EXECUTABLE: '~/bin/codex' },
      readVersion: () => Promise.resolve(null),
    });
    expect(resolved).toEqual({ ok: true, path: join(homedir(), 'bin/codex'), version: null });
  });

  test('without codex on the PATH it says how to install it', async () => {
    const resolved = await resolveCodexExecutable({ env: {}, which: () => null });
    expect(resolved).toMatchObject({ ok: false, reason: 'not_installed', version: null });
    expect(resolved.ok ? '' : resolved.message).toContain('npm install -g @openai/codex');
  });

  test('a codex older than Shinsa needs is refused with the update command', async () => {
    const resolved = await resolveCodexExecutable({
      env: {},
      which: () => '/bin/codex',
      readVersion: () => Promise.resolve('0.100.0'),
    });
    expect(resolved).toEqual({
      ok: false,
      reason: 'outdated',
      version: '0.100.0',
      message: `Codex 0.100.0 is older than Shinsa needs (${CODEX_MINIMUM_VERSION} or newer). Update it from Settings → Agents, or run \`codex update\`.`,
    });
  });

  test('finds codex on the PATH', async () => {
    expect(await resolveCodexExecutable()).toEqual({ ok: true, path: FAKE, version: '0.200.0' });
  });
});
