import { describe, expect, test } from 'bun:test';
import { resolveLocalOnlyRoute } from '../../src/remote/local-only.ts';

describe('local-only routes', () => {
  test('refuse remote changes to remote access, accounts, integrations, secrets, updates and setup', () => {
    for (const path of [
      '/api/remote/pair',
      '/api/remote/devices/enroll',
      '/api/slack/disconnect',
      '/api/accounts/login',
      '/api/extensions/mcp/toggle',
      '/api/secrets/gate-1',
      '/api/schedules/s1/webhook',
      '/api/versions/update',
      '/api/tasks/t1/open',
      '/api/engine/restart',
      '/api/onboarding/setup',
    ]) {
      expect({ path, refused: resolveLocalOnlyRoute('POST', path) }).toEqual({ path, refused: true });
    }
  });

  test('let remote reads through, but never terminals or services', () => {
    for (const path of [
      '/api/remote',
      '/api/slack',
      '/api/accounts',
      '/api/extensions',
      '/api/schedules/s1/webhook',
    ]) {
      expect(resolveLocalOnlyRoute('GET', path)).toBe(false);
    }
    expect(resolveLocalOnlyRoute('GET', '/api/terminals')).toBe(true);
    expect(resolveLocalOnlyRoute('HEAD', '/api/services/s1/start')).toBe(true);
    expect(resolveLocalOnlyRoute('POST', '/api/commands')).toBe(false);
    expect(resolveLocalOnlyRoute('POST', '/api/remotely')).toBe(false);
  });
});
