import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  createServerInstance,
  describeVersion,
  INSTALL_PATH,
  resolveHealth,
  resolveServerInstance,
  SERVER_ENTRY,
} from '../../src/instance/index.ts';
import { createTempDir } from '../helpers/index.ts';

describe('which Shinsa is running', () => {
  test('the install path is the checkout, and the entry its server’s main.ts', () => {
    expect(INSTALL_PATH).toBe(join(import.meta.dirname, '../../../..'));
    expect(SERVER_ENTRY).toBe(join(INSTALL_PATH, 'apps/server/src/main.ts'));
  });

  test('carries the package version, this process and the checkout’s commit when there is one', async () => {
    const before = Date.now();
    const instance = await resolveServerInstance();
    expect(instance).toEqual({
      version: '0.0.0',
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
      installPath: INSTALL_PATH,
      pid: process.pid,
      startedAt: expect.any(Number),
    });
    expect(instance.startedAt).toBeGreaterThanOrEqual(before);
    expect((await resolveServerInstance(createTempDir())).commit).toBeNull();
    expect(createServerInstance(null, 5)).toMatchObject({ commit: null, startedAt: 5 });
  });

  test('names the version with the short commit, or alone', () => {
    expect(describeVersion({ version: '1.2.0', commit: 'abcdef0123456789' })).toBe('1.2.0 (abcdef0)');
    expect(describeVersion({ version: '1.2.0', commit: null })).toBe('1.2.0');
  });

  test('health is ok without damaged entries and counts the uptime from the start', () => {
    const instance = createServerInstance('a'.repeat(40), 1_000);
    expect(resolveHealth({ seq: 9, problems: [] }, '/data', instance, 61_000)).toEqual({
      ok: true,
      seq: 9,
      problems: [],
      ...instance,
      dataDir: '/data',
      uptimeMs: 60_000,
    });
    const problem = { seq: 3, type: 'task.created', kind: 'unreadable' as const, error: 'Not JSON.' };
    expect(resolveHealth({ seq: 9, problems: [problem] }, '/data', instance, 0)).toMatchObject({
      ok: false,
      problems: [problem],
      uptimeMs: 0,
    });
  });
});
