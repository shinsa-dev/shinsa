import { describe, expect, test } from 'bun:test';
import { isOwnerOnlyRoute } from '../../src/remote/local-only.ts';

describe('owner-only routes', () => {
  test('only the owner joins a team from a remote device', () => {
    expect(isOwnerOnlyRoute('POST', '/api/remote/teams/join')).toBe(true);
    expect(isOwnerOnlyRoute('GET', '/api/remote/teams/join')).toBe(false);
    expect(isOwnerOnlyRoute('POST', '/api/remote/teams/create')).toBe(false);
  });
});
