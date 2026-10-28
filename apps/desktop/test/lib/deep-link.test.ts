import { describe, expect, it } from 'bun:test';
import { findDeepLink, isLinkProtocol, parseDeepLink } from '../../src/lib/deep-link.ts';

describe('parseDeepLink', () => {
  it('opens a task by its handle or id', () => {
    expect(parseDeepLink('shinsa://task/LOC-4')).toBe('/tasks/LOC-4');
    expect(parseDeepLink('shinsa://task/0192f3a4-7b1c-7d2e-8f90-123456789abc')).toBe(
      '/tasks/0192f3a4-7b1c-7d2e-8f90-123456789abc'
    );
    expect(parseDeepLink('shinsa://TASK/loc-4/')).toBe('/tasks/loc-4');
    expect(parseDeepLink('shinsa:task/LOC-4')).toBe('/tasks/LOC-4');
  });

  it('opens the pages it knows', () => {
    expect(parseDeepLink('shinsa://')).toBe('/');
    expect(parseDeepLink('shinsa://home')).toBe('/');
    expect(parseDeepLink('shinsa://tasks')).toBe('/tasks');
    expect(parseDeepLink('shinsa://settings')).toBe('/settings');
  });

  it('opens Home for anything it cannot place', () => {
    expect(parseDeepLink('shinsa://task')).toBe('/');
    expect(parseDeepLink('shinsa://task/%E0%A4%A')).toBe('/');
    expect(parseDeepLink('shinsa://task/..%2F..%2Fsettings')).toBe('/');
    expect(parseDeepLink('shinsa://task/LOC-4/chat')).toBe('/');
    expect(parseDeepLink('shinsa://pr/shinsa#12')).toBe('/');
    expect(parseDeepLink('shinsa://elsewhere')).toBe('/');
  });

  it('ignores what is not a Shinsa link', () => {
    expect(parseDeepLink('https://example.com/task/LOC-4')).toBeNull();
    expect(parseDeepLink('not a url')).toBeNull();
  });
});

describe('Shinsa Canary’s links', () => {
  it('opens its own scheme, and the shinsa:// links its pages carry', () => {
    expect(parseDeepLink('shinsa-canary://task/LOC-4', 'shinsa-canary')).toBe('/tasks/LOC-4');
    expect(parseDeepLink('shinsa://task/LOC-4', 'shinsa-canary')).toBe('/tasks/LOC-4');
    expect(parseDeepLink('shinsa-canary://task/LOC-4')).toBeNull();
    expect(isLinkProtocol('SHINSA-CANARY:', 'shinsa-canary')).toBe(true);
    expect(isLinkProtocol('shinsa-beta:', 'shinsa-canary')).toBe(false);
    expect(findDeepLink(['/Applications/Shinsa Canary.app', 'shinsa-canary://home'], 'shinsa-canary')).toBe(
      'shinsa-canary://home'
    );
    expect(findDeepLink(['/Applications/Shinsa.app', 'shinsa-canary://home'])).toBeNull();
  });
});

describe('findDeepLink', () => {
  it('finds the link among launch arguments', () => {
    expect(findDeepLink(['/Applications/Shinsa.app', '--flag', 'shinsa://task/LOC-4'])).toBe(
      'shinsa://task/LOC-4'
    );
    expect(findDeepLink(['electron', '.'])).toBeNull();
  });
});
