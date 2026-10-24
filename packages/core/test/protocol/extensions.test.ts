import { describe, expect, test } from 'bun:test';
import {
  createContextOptimizer,
  isScopeMatch,
  isUnused,
  MCP_NAME_PATTERN,
  OPTIMIZER_LIMITS,
  resolveIdleDays,
  resolveTokenEstimate,
  sumLoadedTokens,
} from '../../src/index.ts';

describe('extension scopes', () => {
  const place = { repoPath: '/code/app', project: 'Superwall' };

  test('a server used everywhere matches every place, even one with no repository', () => {
    expect(isScopeMatch({ kind: 'everywhere' }, place)).toBe(true);
    expect(isScopeMatch({ kind: 'everywhere' }, { repoPath: null, project: null })).toBe(true);
  });

  test('a project scope matches only tasks in that project', () => {
    expect(isScopeMatch({ kind: 'project', project: 'Superwall' }, place)).toBe(true);
    expect(isScopeMatch({ kind: 'project', project: 'Personal' }, place)).toBe(false);
  });

  test('a repository scope matches only that repository', () => {
    expect(isScopeMatch({ kind: 'repo', path: '/code/app' }, place)).toBe(true);
    expect(isScopeMatch({ kind: 'repo', path: '/code/other' }, place)).toBe(false);
  });
});

describe('server names', () => {
  test('take letters, digits, dashes and underscores, and start with a letter or digit', () => {
    expect(MCP_NAME_PATTERN.test('linear')).toBe(true);
    expect(MCP_NAME_PATTERN.test('my_server-2')).toBe(true);
    expect(MCP_NAME_PATTERN.test('-dash')).toBe(false);
    expect(MCP_NAME_PATTERN.test('has space')).toBe(false);
    expect(MCP_NAME_PATTERN.test('a'.repeat(65))).toBe(false);
  });
});

describe('token estimates', () => {
  test('count about one token for every four characters, rounded up', () => {
    expect(resolveTokenEstimate('')).toBe(0);
    expect(resolveTokenEstimate('abcde')).toBe(2);
  });

  test('add up what a run loaded, counting an unmeasured server as nothing', () => {
    expect(
      sumLoadedTokens({
        servers: [
          { name: 'linear', tokens: 1200 },
          { name: 'files', tokens: null },
        ],
        skills: [{ name: 'review', tokens: 40 }],
        plugins: [{ name: 'vercel', tokens: 300 }],
      })
    ).toBe(1540);
  });
});

describe('the context optimizer', () => {
  const day = 86_400_000;
  const now = 100 * day;

  test('starts on, leaving out MCPs and skills unused for 14 days', () => {
    expect(createContextOptimizer()).toEqual({ enabled: true, days: 14, skills: true });
    expect(OPTIMIZER_LIMITS.defaultDays).toBe(14);
  });

  test('counts idle days from the last use, else from when Shinsa first saw it', () => {
    expect(resolveIdleDays({ lastUsedAt: now - 3 * day - 5, firstSeenAt: now - 90 * day }, now)).toBe(3);
    expect(resolveIdleDays({ lastUsedAt: null, firstSeenAt: now - 20 * day }, now)).toBe(20);
    expect(resolveIdleDays({ lastUsedAt: now + day, firstSeenAt: null }, now)).toBe(0);
    expect(resolveIdleDays({ lastUsedAt: null, firstSeenAt: null }, now)).toBeNull();
  });

  test('calls something unused only once it has been idle for the whole window', () => {
    expect(isUnused({ lastUsedAt: now - 14 * day, firstSeenAt: null }, now, 14)).toBe(true);
    expect(isUnused({ lastUsedAt: now - 13 * day, firstSeenAt: null }, now, 14)).toBe(false);
    expect(isUnused({ lastUsedAt: null, firstSeenAt: now - 2 * day }, now, 14)).toBe(false);
    expect(isUnused({ lastUsedAt: null, firstSeenAt: null }, now, 14)).toBe(false);
  });
});
