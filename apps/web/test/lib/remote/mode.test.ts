import { describe, expect, it } from 'bun:test';
import {
  clearEnrollFragment,
  isRemoteBuild,
  resolveRemoteView,
  selectChosenInstance,
  selectEnrollFragment,
  stashEnrollFragment,
  writeChosenInstance,
} from '@/lib/remote/mode.ts';

const FRAGMENT = '#k3x9.machine-key.secret_1';

describe('the remote page’s mode', () => {
  it('is on only in the remote build', () => {
    expect(isRemoteBuild({ VITE_SHINSA_REMOTE: '1' })).toBe(true);
    expect(isRemoteBuild({})).toBe(false);
    expect(isRemoteBuild()).toBe(false);
  });

  it('shows the pair page, the enroll page, your machines, or the machine you chose', () => {
    sessionStorage.clear();
    expect(resolveRemoteView({ pathname: '/pair', search: '?code=K7PQ' }, sessionStorage)).toEqual({
      kind: 'pair',
      claimCode: 'K7PQ',
    });
    expect(resolveRemoteView({ pathname: '/pair', search: '' }, sessionStorage)).toEqual({
      kind: 'pair',
      claimCode: null,
    });
    expect(resolveRemoteView({ pathname: '/enroll', search: '' }, sessionStorage)).toEqual({
      kind: 'enroll',
    });
    expect(resolveRemoteView({ pathname: '/tasks', search: '' }, sessionStorage)).toEqual({
      kind: 'machines',
    });
    writeChosenInstance(sessionStorage, 'k3x9');
    expect(selectChosenInstance(sessionStorage)).toBe('k3x9');
    expect(resolveRemoteView({ pathname: '/tasks', search: '' }, sessionStorage)).toEqual({
      kind: 'instance',
      instanceId: 'k3x9',
    });
    expect(resolveRemoteView({ pathname: '/machines', search: '' }, sessionStorage)).toEqual({
      kind: 'machines',
    });
    writeChosenInstance(sessionStorage, null);
    expect(selectChosenInstance(sessionStorage)).toBeNull();
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
