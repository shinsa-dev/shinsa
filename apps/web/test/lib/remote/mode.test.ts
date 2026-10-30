import { describe, expect, it } from 'bun:test';
import {
  clearEnrollFragment,
  isRemoteBuild,
  resolveRemoteView,
  SERVICE_WORKER_PATH,
  SERVICE_WORKER_SCOPE,
  selectEnrollFragment,
  stashEnrollFragment,
} from '@/lib/remote/mode.ts';

const FRAGMENT = '#k3x9.machine-key.secret_1';

describe('the remote page’s mode', () => {
  it('is on only in the remote build', () => {
    expect(isRemoteBuild({ VITE_SHINSA_REMOTE: '1' })).toBe(true);
    expect(isRemoteBuild({})).toBe(false);
    expect(isRemoteBuild()).toBe(false);
  });

  it('shows the pair page, the enroll page, or the one dashboard of every machine, all at the root', () => {
    expect(resolveRemoteView({ pathname: '/pair', search: '?code=K7PQ' })).toEqual({
      kind: 'pair',
      claimCode: 'K7PQ',
    });
    expect(resolveRemoteView({ pathname: '/pair', search: '' })).toEqual({
      kind: 'pair',
      claimCode: null,
    });
    expect(resolveRemoteView({ pathname: '/enroll', search: '' })).toEqual({ kind: 'enroll' });
    expect(resolveRemoteView({ pathname: '/tasks/LOC-1', search: '' })).toEqual({ kind: 'app' });
    expect(resolveRemoteView({ pathname: '/', search: '' })).toEqual({ kind: 'app' });
    expect(SERVICE_WORKER_PATH).toBe('/sw.js');
    expect(SERVICE_WORKER_SCOPE).toBe('/');
  });

  it('keeps an enrollment link through the GitHub sign-in, and only a valid one', () => {
    sessionStorage.clear();
    stashEnrollFragment(sessionStorage, '#broken');
    expect(selectEnrollFragment(sessionStorage, '')).toBeNull();
    stashEnrollFragment(sessionStorage, FRAGMENT);
    const expected = { instanceId: 'k3x9', machineKey: 'machine-key', secret: 'secret_1' };
    expect(selectEnrollFragment(sessionStorage, '')).toEqual(expected);
    expect(selectEnrollFragment(sessionStorage, '#a.b.c')).toEqual({
      instanceId: 'a',
      machineKey: 'b',
      secret: 'c',
    });
    clearEnrollFragment(sessionStorage);
    expect(selectEnrollFragment(sessionStorage, '')).toBeNull();
  });
});
